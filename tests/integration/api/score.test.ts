import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchScore } from "@/app/api/matches/[id]/score/route";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { SOCKET_EVENTS } from "@/lib/types";
import { createMatch, emitsFor, resetDatabase } from "../../setup/node-setup";

/**
 * Integration tests for `PATCH /api/matches/[id]/score`.
 *
 * The rules that matter: only *live* fixtures accept writes, scores never move
 * backwards, and every accepted change is broadcast to exactly one room.
 */

/** Typed stand-in for Next's generated `RouteContext`. */
function context(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) } as RouteContext<"/api/matches/[id]/score">;
}

function patchRequest(body: unknown, ip = "10.0.0.1"): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/matches/1/score"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const liveMatch = (overrides = {}) => {
  const now = Date.now();
  return createMatch({
    status: "live",
    startTime: new Date(now - 20 * 60_000),
    endTime: new Date(now + 40 * 60_000),
    homeScore: 1,
    awayScore: 0,
    ...overrides,
  });
};

beforeEach(async () => {
  await resetDatabase();
});

describe("PATCH /api/matches/[id]/score", () => {
  it("updates a live fixture and broadcasts to its room only", async () => {
    const match = await liveMatch();

    const response = await patchScore(patchRequest({ homeScore: 2, awayScore: 1 }), context(match.id));
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(data).toMatchObject({ id: match.id, homeScore: 2, awayScore: 1, status: "live" });

    const stored = await prisma.match.findUnique({ where: { id: match.id } });
    expect(stored).toMatchObject({ homeScore: 2, awayScore: 1 });

    const broadcasts = emitsFor(SOCKET_EVENTS.matchScore);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].room).toBe(`match:${match.id}`);
    expect(broadcasts[0].payload).toEqual({
      matchId: match.id,
      homeScore: 2,
      awayScore: 1,
      homeWickets: 0,
      awayWickets: 0,
      homeOvers: null,
      awayOvers: null,
    });
  });

  it("records cricket wickets and reports them in the broadcast and the row", async () => {
    const now = Date.now();
    const match = await createMatch({
      sport: "cricket",
      status: "live",
      startTime: new Date(now - 60 * 60_000),
      endTime: new Date(now + 5 * 60 * 60_000),
      homeScore: 141,
      homeWickets: 3,
      awayScore: 0,
      awayWickets: 0,
    });

    const response = await patchScore(
      patchRequest({ homeScore: 158, awayScore: 0, homeWickets: 4, homeOvers: "33.1" }),
      context(match.id)
    );
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(data).toMatchObject({ homeScore: 158, homeWickets: 4, awayScore: 0, awayWickets: 0 });

    const stored = await prisma.match.findUnique({ where: { id: match.id } });
    expect(stored).toMatchObject({ homeScore: 158, homeWickets: 4 });

    const broadcast = emitsFor(SOCKET_EVENTS.matchScore)[0];
    expect(broadcast.payload).toMatchObject({
      matchId: match.id,
      homeScore: 158,
      homeWickets: 4,
      homeOvers: "33.1",
    });
  });

  it("applies a wickets-only change (a maiden wicket over)", async () => {
    const now = Date.now();
    const match = await createMatch({
      sport: "cricket",
      status: "live",
      startTime: new Date(now - 60 * 60_000),
      endTime: new Date(now + 5 * 60 * 60_000),
      homeScore: 41,
      homeWickets: 0,
    });

    const response = await patchScore(
      patchRequest({ homeScore: 41, awayScore: 0, homeWickets: 1 }),
      context(match.id)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.homeWickets).toBe(1);
    expect(emitsFor(SOCKET_EVENTS.matchScore)).toHaveLength(1);
  });

  it("refuses to reduce wickets within the same innings", async () => {
    const now = Date.now();
    const match = await createMatch({
      sport: "cricket",
      status: "live",
      startTime: new Date(now - 60 * 60_000),
      endTime: new Date(now + 5 * 60 * 60_000),
      homeScore: 88,
      homeWickets: 2,
    });

    const response = await patchScore(
      patchRequest({ homeScore: 90, awayScore: 0, homeWickets: 1 }),
      context(match.id)
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/wickets cannot decrease/i);
  });

  it("allows wickets to reset for a new innings", async () => {
    const now = Date.now();
    const match = await createMatch({
      sport: "cricket",
      status: "live",
      startTime: new Date(now - 60 * 60_000),
      endTime: new Date(now + 5 * 60 * 60_000),
      homeScore: 247,
      homeWickets: 6,
      homeInnings: 1,
      awayScore: 0,
      awayWickets: 0,
      awayInnings: 0,
    });

    // The chase begins: the away side's innings starts, so its wickets drop
    // back to zero even though they were already "0" only for the home side.
    const response = await patchScore(
      patchRequest({
        homeScore: 247,
        awayScore: 14,
        homeWickets: 6,
        awayWickets: 1,
        homeInnings: 1,
        awayInnings: 1,
      }),
      context(match.id)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      homeScore: 247,
      homeWickets: 6,
      awayScore: 14,
      awayWickets: 1,
      awayInnings: 1,
    });
  });

  it("accepts a draw and large cricket totals", async () => {
    const match = await liveMatch({ sport: "cricket" });
    const response = await patchScore(patchRequest({ homeScore: 187, awayScore: 187 }), context(match.id));
    expect(response.status).toBe(200);
    expect((await response.json()).data.homeScore).toBe(187);
  });

  it("returns 404 for an unknown fixture", async () => {
    const response = await patchScore(patchRequest({ homeScore: 1, awayScore: 0 }), context(999_999));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
    expect(emitsFor(SOCKET_EVENTS.matchScore)).toHaveLength(0);
  });

  it("rejects writes to a fixture that has not kicked off", async () => {
    const now = Date.now();
    const match = await createMatch({
      status: "scheduled",
      startTime: new Date(now + 60 * 60_000),
      endTime: new Date(now + 120 * 60_000),
    });

    const response = await patchScore(patchRequest({ homeScore: 1, awayScore: 0 }), context(match.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/scheduled/i);
    expect(emitsFor(SOCKET_EVENTS.matchScore)).toHaveLength(0);
  });

  it("rejects writes to a finished fixture", async () => {
    const now = Date.now();
    const match = await createMatch({
      status: "live",
      startTime: new Date(now - 120 * 60_000),
      endTime: new Date(now - 60 * 60_000),
      homeScore: 3,
      awayScore: 3,
    });

    // The window says finished even though the row claims live.
    const response = await patchScore(patchRequest({ homeScore: 4, awayScore: 3 }), context(match.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/finished/i);
  });

  it("refuses to decrease a score", async () => {
    const match = await liveMatch({ homeScore: 2, awayScore: 1 });

    const lowerHome = await patchScore(patchRequest({ homeScore: 1, awayScore: 1 }), context(match.id));
    expect(lowerHome.status).toBe(409);
    expect((await lowerHome.json()).error.message).toMatch(/cannot decrease/i);

    const lowerAway = await patchScore(patchRequest({ homeScore: 2, awayScore: 0 }), context(match.id));
    expect(lowerAway.status).toBe(409);
  });

  it("treats an identical score as an idempotent no-op", async () => {
    const match = await liveMatch({ homeScore: 2, awayScore: 1 });

    const response = await patchScore(patchRequest({ homeScore: 2, awayScore: 1 }), context(match.id));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ homeScore: 2, awayScore: 1 });

    // Nothing changed, so nothing is broadcast.
    expect(emitsFor(SOCKET_EVENTS.matchScore)).toHaveLength(0);
  });

  it.each([
    ["a missing homeScore", { awayScore: 0 }],
    ["a string score", { homeScore: "2", awayScore: 0 }],
    ["a negative score", { homeScore: -1, awayScore: 0 }],
    ["a fractional score", { homeScore: 1.5, awayScore: 0 }],
  ])("rejects %s with 400", async (_label, body) => {
    const match = await liveMatch();
    const response = await patchScore(patchRequest(body), context(match.id));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid match id", async () => {
    const response = await patchScore(patchRequest({ homeScore: 1, awayScore: 0 }), context("abc"));
    expect(response.status).toBe(400);
  });

  it("rate limits a score flood", async () => {
    const match = await liveMatch({ homeScore: 0, awayScore: 0 });
    const ip = "10.8.8.8";
    const limit = env.RATE_LIMIT_SCORE;
    let limited = false;

    for (let index = 1; index <= limit + 1; index += 1) {
      const response = await patchScore(
        patchRequest({ homeScore: index, awayScore: 0 }, ip),
        context(match.id)
      );
      if (response.status === 429) {
        limited = true;
        break;
      }
    }

    expect(limited, `expected the ${limit}/minute limiter to engage`).toBe(true);
  });
});
