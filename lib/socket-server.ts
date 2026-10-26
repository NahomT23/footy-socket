/**
 * Bridge between Next.js Route Handlers and the Socket.IO instance that lives
 * on the custom HTTP server (`server.mjs`).
 *
 * `server.mjs` is plain Node ESM and cannot import TypeScript, so the two
 * halves share a single `globalThis` slot instead of a module import. Route
 * Handlers only ever need to *emit*; they never own the socket lifecycle.
 */
import { matchRoom, SOCKET_EVENTS } from "./types";
import type {
  Commentary,
  Match,
  MatchScorePayload,
  MatchStatusPayload,
} from "./types";

/** The minimal server-side surface Route Handlers depend on. */
export interface SocketEmitter {
  emit(event: string, ...args: unknown[]): boolean;
  to(room: string): { emit(event: string, ...args: unknown[]): boolean };
  sockets: {
    adapter: {
      rooms: Map<string, Set<string>>;
    };
  };
}

const SOCKET_KEY = "__sportzIo";

const globalForSockets = globalThis as unknown as Record<string, unknown>;

/** Called exactly once by `server.mjs` after Socket.IO is constructed. */
export function attachSocketServer(io: SocketEmitter): void {
  globalForSockets[SOCKET_KEY] = io;
}

/**
 * Returns the emitter, or `null` when the process is not running the custom
 * server (for example `next build`, `next dev` without `server.mjs`, or a unit
 * test). Callers must treat `null` as "realtime is unavailable" rather than an
 * error: HTTP persistence must still succeed so clients can recover by refetch.
 */
export function getSocketServer(): SocketEmitter | null {
  const io = globalForSockets[SOCKET_KEY];
  return (io as SocketEmitter | undefined) ?? null;
}

export function emitMatchCreated(match: Match): void {
  getSocketServer()?.emit(SOCKET_EVENTS.matchCreated, match);
}

export function emitScoreUpdate(payload: MatchScorePayload): void {
  getSocketServer()?.to(matchRoom(payload.matchId)).emit(SOCKET_EVENTS.matchScore, payload);
}

export function emitCommentary(commentary: Commentary): void {
  getSocketServer()
    ?.to(matchRoom(commentary.matchId))
    .emit(SOCKET_EVENTS.matchCommentary, commentary);
}

export function emitMatchStatus(payload: MatchStatusPayload): void {
  getSocketServer()?.emit(SOCKET_EVENTS.matchStatus, payload);
}

/** Number of sockets currently subscribed to a fixture room (0 if unknown). */
export function roomSize(matchId: number): number {
  const io = getSocketServer();
  if (!io) return 0;
  return io.sockets.adapter.rooms.get(matchRoom(matchId))?.size ?? 0;
}
