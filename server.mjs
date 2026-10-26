/**
 * Sportz custom HTTP server.
 *
 * One port serves three things:
 *   1. Socket.IO on `/socket.io` (real-time score + commentary fan-out)
 *   2. `/healthz` (cheap liveness probe, answered before Next.js is involved)
 *   3. everything else -> the Next.js App Router request handler
 *
 * Runs as plain Node ESM (no build step), so it deliberately avoids importing
 * TypeScript from `lib/`. Anything it needs from the type layer is mirrored
 * here and guarded by `npm run check:contract`.
 */
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";

import { startIngest } from "./lib/ingest.mjs";

process.loadEnvFile?.(".env");

/* ------------------------------------------------------------------ */
/* Contract (mirrors lib/types.ts + lib/match-status.ts)               */
/* ------------------------------------------------------------------ */

const EVENTS = {
  joinMatch: "join:match",
  leaveMatch: "leave:match",
  matchCreated: "match:created",
  matchScore: "match:score",
  matchCommentary: "match:commentary",
  matchStatus: "match:status",
  subscriptionAck: "subscription:ack",
  rateLimited: "rate:limited",
};

const MAX_MATCH_ID = 2_147_483_647;

/** Tuning knobs, kept next to the code that consumes them. */
const LIMITS = {
  /** Socket.IO engine frame cap — first line of defence against socket flooding. */
  maxHttpBufferSize: 16 * 1024,
  /** Refuse new sockets once an IP already holds this many open connections. */
  maxConnectionsPerIp: 12,
  /** Room operations allowed per socket per window. */
  roomOps: 40,
  roomOpWindowMs: 10_000,
  /** Hard ceiling on room membership per socket (a client tunes into one match). */
  maxRoomsPerSocket: 3,
  /** How often the sweeper reconciles stored status with wall-clock time. */
  sweepIntervalMs: 10_000,
  /** Grace period before shutting down, so clients receive the disconnect. */
  shutdownGraceMs: 500,
};

const prisma = new PrismaClient({ log: ["warn", "error"] });

/* ------------------------------------------------------------------ */
/* Validation (dependency-free mirror of lib/validations.ts)           */
/* ------------------------------------------------------------------ */

function parseMatchId(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value > 0 && value <= MAX_MATCH_ID ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_MATCH_ID) {
      return parsed;
    }
  }
  return null;
}

/** Returns the matchId or null; never throws on hostile input. */
function parseJoinPayload(payload) {
  if (payload === null || typeof payload !== "object") return null;
  return parseMatchId(payload.matchId);
}

function matchRoom(matchId) {
  return `match:${matchId}`;
}

/* ------------------------------------------------------------------ */
/* Abuse shields                                                       */
/* ------------------------------------------------------------------ */

/** ip -> open socket count */
const connectionsByIp = new Map();
/** socket.id -> { rooms: Set<string>, tokens: number, windowStart: number } */
const socketState = new Map();

function clientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address ?? "unknown";
}

/**
 * Token-bucket check for client -> server events.
 * Returns `retryAfterMs` when the caller is over budget, otherwise `null`.
 */
function consumeToken(state) {
  const now = Date.now();
  if (now - state.windowStart >= LIMITS.roomOpWindowMs) {
    state.windowStart = now;
    state.tokens = LIMITS.roomOps;
  }
  if (state.tokens <= 0) {
    return state.windowStart + LIMITS.roomOpWindowMs - now;
  }
  state.tokens -= 1;
  return null;
}

/* ------------------------------------------------------------------ */
/* Status sweeper                                                      */
/* ------------------------------------------------------------------ */

/**
 * Derives status from the fixture time window. Duplicated from
 * `lib/match-status.ts` because this file cannot import TypeScript.
 * `npm run check:contract` fails if the two implementations ever disagree.
 */
function deriveStatus(startTime, endTime, now = new Date()) {
  if (now < startTime) return "scheduled";
  if (now >= endTime) return "finished";
  return "live";
}

let sweepTimer = null;

function startStatusSweeper(io) {
  const sweep = async () => {
    try {
      // Sim rows trust the wall clock (their window is authored). Provider
      // rows (ESPN etc.) trust the provider's lifecycle instead — a real
      // fixture can be paused, delayed or in extra time beyond any estimate.
      const pending = await prisma.match.findMany({
        where: { status: { not: "finished" }, providerKey: "sim" },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          homeScore: true,
          awayScore: true,
          homeWickets: true,
          awayWickets: true,
        },
      });

      const now = new Date();
      for (const match of pending) {
        const next = deriveStatus(match.startTime, match.endTime, now);
        if (next === match.status) continue;

        const updated = await prisma.match.update({
          where: { id: match.id },
          data: { status: next },
          select: {
            id: true,
            status: true,
            homeScore: true,
            awayScore: true,
            homeWickets: true,
            awayWickets: true,
          },
        });

        io.emit(EVENTS.matchStatus, {
          matchId: updated.id,
          status: updated.status,
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
          homeWickets: updated.homeWickets,
          awayWickets: updated.awayWickets,
        });

        // Finished fixtures drop their room: subscriptions are detached
        // automatically so idle clients stop receiving traffic.
        if (updated.status === "finished") {
          io.in(matchRoom(updated.id)).socketsLeave(matchRoom(updated.id));
        }
      }
    } catch (error) {
      // A dead database must not take the realtime gateway down with it.
      console.error("[sweeper] status reconciliation failed:", error.message);
    }
  };

  sweepTimer = setInterval(sweep, LIMITS.sweepIntervalMs);
  sweepTimer.unref?.();
  void sweep();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "127.0.0.1";

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        sockets: io.engine.clientsCount,
        rooms: io.sockets.adapter.rooms.size,
        transport: "socket.io",
      })
    );
    return;
  }

  handle(req, res);
});

const io = new Server(httpServer, {
  path: "/socket.io",
  maxHttpBufferSize: LIMITS.maxHttpBufferSize,
  connectTimeout: 20_000,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  cors: { origin: true, credentials: true },
});

// Route Handlers reach the emitter through this slot (lib/socket-server.ts).
globalThis.__sportzIo = io;

io.on("connection", (socket) => {
  const ip = clientIp(socket);
  const openForIp = (connectionsByIp.get(ip) ?? 0) + 1;

  if (openForIp > LIMITS.maxConnectionsPerIp) {
    connectionsByIp.set(ip, openForIp - 1);
    socket.emit(EVENTS.rateLimited, {
      event: "connection",
      message: `Too many open connections from ${ip}`,
      retryAfterMs: 30_000,
    });
    socket.disconnect(true);
    return;
  }

  connectionsByIp.set(ip, openForIp);
  socketState.set(socket.id, {
    rooms: new Set(),
    tokens: LIMITS.roomOps,
    windowStart: Date.now(),
  });
  console.log(`[socket] connected ${socket.id} (${socket.conn.transport.name}) from ${ip}`);

  /** Shared handler for join/leave so both paths validate identically. */
  const handleRoomOp = (event, payload, ack) => {
    const state = socketState.get(socket.id);
    if (!state) return;

    const retryAfterMs = consumeToken(state);
    if (retryAfterMs !== null) {
      socket.emit(EVENTS.rateLimited, {
        event,
        message: "Rate limit exceeded for room operations",
        retryAfterMs,
      });
      if (typeof ack === "function") {
        ack({ matchId: 0, room: "", joined: false, subscribers: 0 });
      }
      return;
    }

    const matchId = parseJoinPayload(payload);
    if (matchId === null) {
      socket.emit(EVENTS.rateLimited, {
        event,
        message: "Invalid payload: expected { matchId: positive integer }",
        retryAfterMs: 0,
      });
      if (typeof ack === "function") {
        ack({ matchId: 0, room: "", joined: false, subscribers: 0 });
      }
      return;
    }

    const room = matchRoom(matchId);
    const isJoin = event === EVENTS.joinMatch;

    if (isJoin) {
      if (!state.rooms.has(room) && state.rooms.size >= LIMITS.maxRoomsPerSocket) {
        // Auto-unsubscribe the oldest room instead of silently ignoring the join.
        const oldest = state.rooms.values().next().value;
        socket.leave(oldest);
        state.rooms.delete(oldest);
      }
      socket.join(room);
      state.rooms.add(room);
    } else {
      socket.leave(room);
      state.rooms.delete(room);
    }

    const ackPayload = {
      matchId,
      room,
      joined: isJoin,
      subscribers: io.sockets.adapter.rooms.get(room)?.size ?? 0,
    };

    if (typeof ack === "function") ack(ackPayload);
    socket.emit(EVENTS.subscriptionAck, ackPayload);
  };

  socket.on(EVENTS.joinMatch, (payload, ack) => handleRoomOp(EVENTS.joinMatch, payload, ack));
  socket.on(EVENTS.leaveMatch, (payload, ack) => handleRoomOp(EVENTS.leaveMatch, payload, ack));

  // There is no unhandled-event logging on purpose: unknown events from a
  // hostile client are simply dropped by Socket.IO.
  socket.on("disconnect", (reason) => {
    socketState.delete(socket.id);
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, remaining);
    console.log(`[socket] disconnected ${socket.id} (${reason})`);
  });
});

startStatusSweeper(io);

/**
 * Data mode: "espn" (default) streams real fixtures from the public ESPN
 * feed; "sim" hands the dataset entirely to the simulator (`npm run seed`).
 */
const dataMode = (process.env.SPORTS_DATA ?? "espn").toLowerCase();
let stopIngest = null;
if (dataMode === "espn") {
  stopIngest = startIngest({ prisma, io, events: EVENTS });
  console.log("> Provider ingest: ESPN mode");
} else {
  console.log(`> Provider ingest disabled (SPORTS_DATA=${dataMode} — simulator manages data)`);
}

httpServer.listen(port, hostname, () => {
  console.log(`> Sportz ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);
  console.log("> Socket.IO listening on /socket.io");
});

httpServer.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`> Port ${port} is already in use. Stop the other process or set PORT.`);
  } else {
    console.error("> HTTP server error:", error);
  }
  process.exit(1);
});

/* ------------------------------------------------------------------ */
/* Graceful shutdown                                                   */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n> ${signal} received — shutting down...`);

  if (sweepTimer) clearInterval(sweepTimer);
  stopIngest?.();
  io.close();
  httpServer.close();
  await prisma.$disconnect().catch(() => {});

  setTimeout(() => process.exit(0), LIMITS.shutdownGraceMs).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(signal));
}
