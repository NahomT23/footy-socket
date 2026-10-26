/**
 * Per-worker test setup.
 *
 * - Loads jest-dom matchers for component suites.
 * - Exposes `resetDatabase()` used by every database-backed suite.
 * - Installs a fake Socket.IO emitter so Route Handler broadcasts can be
 *   asserted without booting the custom server.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { attachSocketServer, type SocketEmitter } from "@/lib/socket-server";

/** Deletes all rows in dependency order (commentary first, then matches). */
export async function resetDatabase(): Promise<void> {
  await prisma.commentary.deleteMany();
  await prisma.match.deleteMany();
}

/** Builds a fixture row quickly; every field can be overridden. */
export async function createMatch(overrides: Partial<Parameters<typeof prisma.match.create>[0]["data"]> = {}) {
  const now = Date.now();
  return prisma.match.create({
    data: {
      sport: "football",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      status: "live",
      startTime: new Date(now - 10 * 60_000),
      endTime: new Date(now + 60 * 60_000),
      homeScore: 0,
      awayScore: 0,
      ...overrides,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Fake realtime emitter                                               */
/* ------------------------------------------------------------------ */

export interface RecordedEmit {
  room: string | null;
  event: string;
  payload: unknown;
}

export const emitted: RecordedEmit[] = [];

/**
 * Installs a recording emitter on the same `globalThis` slot the Route
 * Handlers use, so we can assert *what* would have been broadcast.
 */
export function installFakeSocketServer(): void {
  emitted.length = 0;

  const buildEmitter = (room: string | null): SocketEmitter => ({
    emit(event: string, ...args: unknown[]) {
      emitted.push({ room, event, payload: args[0] });
      return true;
    },
    to(nextRoom: string) {
      return buildEmitter(nextRoom) as { emit: SocketEmitter["emit"] };
    },
    sockets: { adapter: { rooms: new Map() } },
  });

  attachSocketServer(buildEmitter(null));
}

/** Every recorded emit for a given event name. */
export function emitsFor(event: string): RecordedEmit[] {
  return emitted.filter((entry) => entry.event === event);
}

beforeEach(() => {
  installFakeSocketServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});
