#!/usr/bin/env node
/**
 * Sportz realtime contract verification.
 *
 * Acts as a headless "second client": it joins a fixture room over Socket.IO
 * while you run the simulation engine, then asserts the behaviours the product
 * spec promises. Any failed assertion exits non-zero, so this is safe to wire
 * into CI.
 *
 * Usage (two terminals):
 *   npm run dev
 *   npm run verify:realtime
 *   npm run seed -- --speed 6
 *
 * Or point it at an existing match:
 *   node scripts/verify-realtime.mjs --match 1 --watch 45
 */
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";

import { DEFAULT_BASE_URL, apiFetch, clock, log, paint, parseArgs, sleep } from "./lib/http.mjs";

const { flags } = parseArgs();
const baseUrl = String(flags.url ?? DEFAULT_BASE_URL);
const watchSeconds = Number(flags.watch ?? 45);
const requestedMatchId = flags.match ? Number(flags.match) : null;

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Tiny assertion harness                                              */
/* ------------------------------------------------------------------ */

const results = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  const icon = passed ? paint.green("✓") : paint.red("✗");
  console.log(`${clock()}  ${icon} ${name}${detail ? paint.dim(` — ${detail}`) : ""}`);
}

function summarize() {
  const failed = results.filter((result) => !result.passed);
  console.log(
    `\n${failed.length === 0 ? paint.green("✓ PASS") : paint.red("✗ FAIL")} ` +
      `${results.length - failed.length}/${results.length} checks passed`
  );
  return failed.length === 0;
}

/* ------------------------------------------------------------------ */
/* Subject fixture                                                     */
/* ------------------------------------------------------------------ */

async function pickMatch() {
  if (requestedMatchId) return requestedMatchId;

  const matches = await apiFetch(baseUrl, "/api/matches?status=live");
  if (!matches || matches.length === 0) {
    console.error(paint.red("No live fixtures found. Seed one first: npm run seed -- --speed 6"));
    process.exit(1);
  }

  // Prefer the fixture with the most remaining time, so score writes are still
  // accepted while the checks run.
  return [...matches].sort((a, b) => Date.parse(b.endTime) - Date.parse(a.endTime))[0].id;
}

/** Another live fixture, used to prove room isolation. */
async function pickOtherMatch(excludeId) {
  const matches = await apiFetch(baseUrl, "/api/matches?status=live");
  const other = (matches ?? []).find((match) => match.id !== excludeId);
  return other?.id ?? null;
}

/** Highest scripted sequence for a fixture, so probes never collide with it. */
async function nextSequence(matchId) {
  const latest = await apiFetch(baseUrl, `/api/matches/${matchId}/commentary?limit=1`);
  const highest = (latest ?? []).reduce((max, row) => Math.max(max, row.sequence ?? 0), 0);
  return highest + 1;
}

/**
 * Generates its own commentary + score traffic on the subject fixture.
 *
 * `--self-driven` (the default) makes this harness deterministic and
 * independent of the simulator's timing; `--passive` instead listens for
 * whatever the simulation engine broadcasts, which is how you observe genuine
 * simulator output.
 */
async function emitProbeTraffic(matchId, match, label, sequenceBase) {
  await apiFetch(baseUrl, `/api/matches/${matchId}/commentary`, {
    method: "POST",
    body: {
      minute: 90,
      sequence: sequenceBase,
      period: "Verification",
      eventType: "goal",
      actor: "Verify Bot",
      team: match.homeTeam,
      message: `${label} commentary probe`,
      metadata: { probe: true },
      tags: ["verification"],
    },
  });

  let scoreAccepted = false;
  await apiFetch(baseUrl, `/api/matches/${matchId}/score`, {
    method: "PATCH",
    body: { homeScore: match.homeScore + 1, awayScore: match.awayScore },
  })
    .then(() => {
      scoreAccepted = true;
    })
    .catch((error) => {
      // A finished fixture legitimately refuses score writes.
      log("probe", paint.dim(`score write skipped: ${error.message}`));
    });

  await apiFetch(baseUrl, `/api/matches/${matchId}/commentary`, {
    method: "POST",
    body: {
      minute: 90,
      sequence: sequenceBase + 1,
      period: "Verification",
      eventType: "info",
      message: `${label} second commentary probe`,
      tags: ["verification"],
    },
  });

  return { scoreAccepted };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\n${paint.bold(paint.yellow(" SPORTZ "))} ${paint.dim("realtime verification")}  ${baseUrl}\n`);

  const matchId = await pickMatch();
  const otherMatchId = await pickOtherMatch(matchId);
  const subject = await apiFetch(baseUrl, `/api/matches/${matchId}`);
  const selfDriven = flags.passive !== true;
  log("subject", `#${matchId} ${subject.homeTeam} vs ${subject.awayTeam} (${subject.status})`);
  log("mode", selfDriven ? "self-driven probes" : "passive (needs the simulator running)");

  const received = {
    commentary: [],
    scores: [],
    statuses: [],
    acks: [],
    limited: [],
    created: [],
    foreign: [],
  };

  const socket = io(baseUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
  });

  /** Fixture currently being observed; switches if the simulator re-seeds. */
  let subjectId = matchId;

  socket.on("connect", () => check("socket connects to /socket.io", true, `id=${socket.id}`));
  socket.on("connect_error", (error) => check("socket connects to /socket.io", false, error.message));
  socket.on("match:commentary", (entry) => {
    if (entry.matchId === subjectId) received.commentary.push(entry);
    else received.foreign.push({ event: "match:commentary", entry });
  });
  socket.on("match:score", (payload) => {
    if (payload.matchId === subjectId) received.scores.push(payload);
    else received.foreign.push({ event: "match:score", payload });
  });
  socket.on("match:status", (payload) => {
    if (payload.matchId === subjectId) received.statuses.push(payload);
  });
  socket.on("match:created", (match) => received.created.push(match));
  socket.on("subscription:ack", (ack) => received.acks.push(ack));
  socket.on("rate:limited", (payload) => received.limited.push(payload));

  /**
   * The simulator wipes and recreates fixtures on every run, so the original
   * subject id stops existing. Follow the newest live fixture instead — the
   * same thing the dashboard does when it receives `match:created`.
   */
  if (flags.passive === true) {
    socket.on("match:created", (match) => {
      if (match.status !== "live" || match.id === subjectId) return;
      const previous = subjectId;
      subjectId = match.id;
      socket.emit("leave:match", { matchId: previous });
      socket.emit("join:match", { matchId: subjectId });
      log("retarget", `switched observation to match:${subjectId} (${match.homeTeam} vs ${match.awayTeam})`);
    });
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connect timeout")), 10_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  /* ---------------------------------------------------------------- */
  /* 1. Subscription acknowledgement                                   */
  /* ---------------------------------------------------------------- */

  const ack = await new Promise((resolve) => {
    socket.emit("join:match", { matchId }, resolve);
    setTimeout(() => resolve(null), 5_000);
  });

  check("join:match is acknowledged", ack !== null, ack ? JSON.stringify(ack) : "no ack");
  check(
    "ack reports the fixture room",
    ack?.room === `match:${matchId}` && ack?.joined === true,
    ack ? `room=${ack.room} subscribers=${ack.subscribers}` : ""
  );

  // The ack callback fires synchronously on receipt; the mirrored
  // `subscription:ack` event needs one more network tick to arrive.
  await sleep(300);
  check("ack is also delivered as subscription:ack", received.acks.length > 0);

  /* ---------------------------------------------------------------- */
  /* 2. Malformed payloads are rejected, connection survives           */
  /* ---------------------------------------------------------------- */

  received.limited.length = 0;
  socket.emit("join:match", { matchId: "not-a-number" });
  socket.emit("join:match", null);
  socket.emit("join:match", { matchId: -5 });
  await sleep(600);

  check(
    "invalid join payloads are rejected without disconnecting",
    received.limited.length >= 3 && socket.connected,
    `${received.limited.length} rejection(s), connected=${socket.connected}`
  );

  /* ---------------------------------------------------------------- */
  /* 3. Room isolation: an unjoined fixture must not leak in           */
  /* ---------------------------------------------------------------- */

  if (otherMatchId === null) {
    check("a second live fixture exists for the isolation check", false, "seed more fixtures");
  } else {
    const otherWrite = await apiFetch(baseUrl, `/api/matches/${otherMatchId}/commentary`, {
      method: "POST",
      body: {
        minute: 90,
        sequence: await nextSequence(otherMatchId),
        period: "Verification",
        eventType: "info",
        message: "Isolation probe: this must NOT reach the other room.",
        tags: ["probe"],
      },
    }).catch((error) => ({ error: error.message }));

    await sleep(700);
    check(
      "events for another fixture do not reach this room",
      received.foreign.length === 0,
      received.foreign.length === 0 ? `no leakage from match:${otherMatchId}` : JSON.stringify(received.foreign.slice(0, 2))
    );
    check("isolation probe was persisted", !otherWrite?.error, otherWrite?.error ?? `id=${otherWrite?.id}`);
  }

  /* ---------------------------------------------------------------- */
  /* 4. Live traffic                                                   */
  /* ---------------------------------------------------------------- */

  const before = received.commentary.length;
  let scoreAccepted = false;

  if (selfDriven) {
    log("probing", `publishing commentary + score for match:${subjectId}`);
    const fresh = await apiFetch(baseUrl, `/api/matches/${subjectId}`);
    ({ scoreAccepted } = await emitProbeTraffic(subjectId, fresh, "Self-driven", await nextSequence(subjectId)));
    await sleep(1_200);
  } else {
    log("watching", `listening on match:${matchId} for ${watchSeconds}s — start the simulator now`);
    const deadline = Date.now() + watchSeconds * 1_000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (received.commentary.length > before && received.scores.length > 0) break;
    }
  }

  const hasTraffic = received.commentary.length > before;
  check(
    "match:commentary is broadcast to the room",
    hasTraffic,
    hasTraffic ? `${received.commentary.length - before} event(s)` : "no events observed"
  );

  const expectedScore = (await apiFetch(baseUrl, `/api/matches/${subjectId}`)).homeScore;
  const sawScore = received.scores.some(
    (payload) => payload.matchId === subjectId && payload.homeScore === expectedScore
  );

  if (selfDriven && !scoreAccepted) {
    check(
      "match:score is broadcast to the room with the new values",
      false,
      "fixture is no longer accepting score writes — re-seed and retry"
    );
  } else {
    check(
      "match:score is broadcast to the room with the new values",
      received.scores.length > 0 && (selfDriven ? sawScore : true),
      received.scores.length > 0
        ? received.scores.map((entry) => `${entry.homeScore}-${entry.awayScore}`).join(", ")
        : "no score changes observed"
    );
  }

  if (hasTraffic) {
    const sample = received.commentary[received.commentary.length - 1];
    check(
      "commentary payload carries structured sports metadata",
      typeof sample.message === "string" && typeof sample.createdAt === "string" && sample.matchId === subjectId,
      `eventType=${sample.eventType ?? "null"} seq=${sample.sequence ?? "null"}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* 5. REST persistence matches what was broadcast                    */
  /* ---------------------------------------------------------------- */

  const persisted = await apiFetch(baseUrl, `/api/matches/${subjectId}/commentary?limit=100`);
  const broadcastIds = new Set(received.commentary.map((entry) => entry.id));
  const allPersisted = [...broadcastIds].every((id) => persisted.some((row) => row.id === id));
  check(
    "every broadcast commentary row exists in PostgreSQL",
    broadcastIds.size > 0 && allPersisted,
    `${broadcastIds.size} broadcast / ${persisted.length} stored`
  );

  /* ---------------------------------------------------------------- */
  /* 6. Unsubscribe detaches the room                                  */
  /* ---------------------------------------------------------------- */

  const leaveAck = await new Promise((resolve) => {
    socket.emit("leave:match", { matchId: subjectId }, resolve);
    setTimeout(() => resolve(null), 5_000);
  });
  check("leave:match is acknowledged", leaveAck !== null, leaveAck ? `subscribers=${leaveAck.subscribers}` : "");

  const afterLeave = received.commentary.length;
  await apiFetch(baseUrl, `/api/matches/${subjectId}/commentary`, {
    method: "POST",
    body: {
      minute: 90,
      sequence: await nextSequence(subjectId),
      period: "Verification",
      eventType: "info",
      message: "Post-unsubscribe probe: this must NOT be delivered.",
      tags: ["probe"],
    },
  }).catch(() => null);

  await sleep(800);
  check(
    "no events are delivered after leaving the room",
    received.commentary.length === afterLeave,
    `received ${received.commentary.length - afterLeave} after leave`
  );

  /* ---------------------------------------------------------------- */
  /* 7. Rate limiting kicks in under flood                             */
  /* ---------------------------------------------------------------- */

  received.limited.length = 0;
  for (let index = 0; index < 80; index += 1) {
    socket.emit("join:match", { matchId: subjectId });
  }
  await sleep(900);
  check(
    "socket flooding is rate limited",
    received.limited.length > 0,
    `${received.limited.length} rate-limit notice(s)`
  );

  socket.disconnect();
  await prisma.$disconnect();

  const passed = summarize();
  process.exit(passed ? 0 : 1);
}

main().catch(async (error) => {
  console.error(paint.red(`\n✗ Verification crashed: ${error.message}`));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
