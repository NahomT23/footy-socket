import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GET as getCommentary,
  POST as postCommentary,
} from "@/app/api/matches/[id]/commentary/route";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { SOCKET_EVENTS } from "@/lib/types";
import { createMatch, emitsFor, resetDatabase } from "../../setup/node-setup";

/**
 * Integration tests for the commentary endpoints.
 *
 * Covers ordering (explicit `sequence` beats insertion order), the unique
 * `(matchId, sequence)` constraint surfacing as a 409, and room-scoped
 * broadcasting.
 */

type CommentaryContext = RouteContext<"/api/matches/[id]/commentary">;

function context(id: string | number, query = ""): CommentaryContext {
  void query;
  return { params: Promise.resolve({ id: String(id) }) } as CommentaryContext;
}

function getRequest(query = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/matches/1/commentary${query}`));
}

function postRequest(body: unknown, ip = "10.0.0.1"): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/matches/1/commentary"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/matches/[id]/commentary", () => {
  it("returns an empty feed for a fixture with no events", async () => {
    const match = await createMatch();
    const response = await getCommentary(getRequest(), context(match.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it("returns the newest entry first for the fixture", async () => {
    const match = await createMatch();
    await prisma.commentary.createMany({
      data: [
        { matchId: match.id, sequence: 1, message: "Kick-off", createdAt: new Date(Date.now() - 3_000) },
        { matchId: match.id, sequence: 2, message: "Goal", createdAt: new Date(Date.now() - 2_000) },
        { matchId: match.id, sequence: 3, message: "Full time", createdAt: new Date(Date.now() - 1_000) },
      ],
    });

    const body = await (await getCommentary(getRequest(), context(match.id))).json();
    expect(body.data.map((row: { message: string }) => row.message)).toEqual([
      "Full time",
      "Goal",
      "Kick-off",
    ]);
  });

  it("orders by sequence even when insertion order disagrees", async () => {
    const match = await createMatch();
    // Inserted out of order, as a jittery network would deliver them.
    await prisma.commentary.create({
      data: { matchId: match.id, sequence: 5, message: "Fifth", createdAt: new Date() },
    });
    await prisma.commentary.create({
      data: { matchId: match.id, sequence: 4, message: "Fourth", createdAt: new Date(Date.now() + 1_000) },
    });

    const body = await (await getCommentary(getRequest(), context(match.id))).json();
    expect(body.data.map((row: { message: string }) => row.message)).toEqual(["Fifth", "Fourth"]);
  });

  it("never leaks commentary from another fixture", async () => {
    const match = await createMatch();
    const other = await createMatch({ homeTeam: "Other" });
    await prisma.commentary.create({
      data: { matchId: other.id, sequence: 1, message: "Other fixture event" },
    });

    const body = await (await getCommentary(getRequest(), context(match.id))).json();
    expect(body.data).toHaveLength(0);
  });

  it("honours the limit parameter", async () => {
    const match = await createMatch();
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      await prisma.commentary.create({
        data: { matchId: match.id, sequence, message: `Event ${sequence}` },
      });
    }

    const body = await (await getCommentary(getRequest("?limit=2"), context(match.id))).json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].message).toBe("Event 5");
  });

  it("returns 404 for an unknown fixture", async () => {
    const response = await getCommentary(getRequest(), context(999_999));
    expect(response.status).toBe(404);
  });

  it("rejects an invalid id and an invalid limit", async () => {
    const match = await createMatch();
    expect((await getCommentary(getRequest(), context("nope"))).status).toBe(400);
    expect((await getCommentary(getRequest("?limit=101"), context(match.id))).status).toBe(400);
  });
});

describe("POST /api/matches/[id]/commentary", () => {
  const payload = {
    minute: 45,
    sequence: 1,
    period: "First Half",
    eventType: "goal",
    actor: "Bukayo Saka",
    team: "Arsenal",
    message: "GOAL! Saka curls it in.",
    metadata: { xg: 0.44 },
    tags: ["goal"],
  };

  it("persists the entry, returns 201 and broadcasts to the room", async () => {
    const match = await createMatch();

    const response = await postCommentary(postRequest(payload), context(match.id));
    expect(response.status).toBe(201);

    const { data } = await response.json();
    expect(data).toMatchObject({
      matchId: match.id,
      minute: 45,
      sequence: 1,
      eventType: "goal",
      actor: "Bukayo Saka",
      metadata: { xg: 0.44 },
      tags: ["goal"],
    });
    expect(data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const stored = await prisma.commentary.findUnique({ where: { id: data.id } });
    expect(stored?.message).toBe(payload.message);

    const broadcasts = emitsFor(SOCKET_EVENTS.matchCommentary);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].room).toBe(`match:${match.id}`);
    expect((broadcasts[0].payload as { id: number }).id).toBe(data.id);
  });

  it("accepts a minimal entry with only a message", async () => {
    const match = await createMatch();
    const response = await postCommentary(postRequest({ message: "Drinks break." }), context(match.id));
    expect(response.status).toBe(201);

    const { data } = await response.json();
    expect(data).toMatchObject({ minute: null, sequence: null, eventType: null, tags: [] });
  });

  it("rejects a duplicate sequence with 409 (no doubled feed)", async () => {
    const match = await createMatch();
    await postCommentary(postRequest(payload), context(match.id, ""));
    const duplicate = await postCommentary(postRequest(payload), context(match.id));

    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("CONFLICT");
    // Only the original broadcast happened.
    expect(emitsFor(SOCKET_EVENTS.matchCommentary)).toHaveLength(1);
    expect(await prisma.commentary.count({ where: { matchId: match.id } })).toBe(1);
  });

  it("allows repeated null sequences (no false conflict)", async () => {
    const match = await createMatch();
    const first = await postCommentary(postRequest({ message: "First" }), context(match.id));
    const second = await postCommentary(postRequest({ message: "Second" }), context(match.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("returns 404 for an unknown fixture", async () => {
    const response = await postCommentary(postRequest(payload), context(999_999));
    expect(response.status).toBe(404);
    expect(emitsFor(SOCKET_EVENTS.matchCommentary)).toHaveLength(0);
  });

  it.each([
    ["an empty message", { message: "   " }],
    ["a missing message", { minute: 12 }],
    ["an unknown event type", { message: "x", eventType: "touchdown" }],
    ["a negative minute", { message: "x", minute: -5 }],
    ["too many tags", { message: "x", tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }],
  ])("rejects %s with 400", async (_label, body) => {
    const match = await createMatch();
    const response = await postCommentary(postRequest(body), context(match.id));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rate limits a commentary flood", async () => {
    const match = await createMatch();
    const ip = "10.7.7.7";
    const limit = env.RATE_LIMIT_COMMENTARY;
    let limited = false;

    for (let index = 0; index < limit + 1; index += 1) {
      const response = await postCommentary(
        postRequest({ message: `Event ${index}` }, ip),
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
