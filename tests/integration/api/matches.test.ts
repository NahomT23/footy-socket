import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as getMatches, POST as postMatch } from "@/app/api/matches/route";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { SOCKET_EVENTS } from "@/lib/types";
import { createMatch, emitsFor, resetDatabase } from "../../setup/node-setup";

/**
 * Integration tests for `/api/matches`.
 *
 * These call the exported Route Handlers directly (no HTTP layer) against a
 * real PostgreSQL database, which is where the derived-status and ordering
 * behaviour actually lives.
 */

function getRequest(query = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/matches${query}`));
}

function postRequest(body: unknown, ip = "10.0.0.1"): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/matches"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const validPayload = () => {
  const now = Date.now();
  return {
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    startTime: new Date(now - 5 * 60_000).toISOString(),
    endTime: new Date(now + 60 * 60_000).toISOString(),
  };
};

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/matches", () => {
  it("returns an empty list when there are no fixtures", async () => {
    const response = await getMatches(getRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it("orders fixtures newest first", async () => {
    const older = await createMatch({ homeTeam: "Older", createdAt: new Date(Date.now() - 120_000) });
    const newer = await createMatch({ homeTeam: "Newer", createdAt: new Date() });

    const body = await (await getMatches(getRequest())).json();
    expect(body.data.map((match: { id: number }) => match.id)).toEqual([newer.id, older.id]);
  });

  it("honours the limit parameter and caps it at 100", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createMatch({ homeTeam: `Team ${index}` });
    }

    const limited = await (await getMatches(getRequest("?limit=2"))).json();
    expect(limited.data).toHaveLength(2);

    const tooBig = await getMatches(getRequest("?limit=101"));
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-numeric limit", async () => {
    const response = await getMatches(getRequest("?limit=abc"));
    expect(response.status).toBe(400);
  });

  it("filters by derived status", async () => {
    const now = Date.now();
    await createMatch({ homeTeam: "Live", status: "live", startTime: new Date(now - 60_000), endTime: new Date(now + 60_000) });
    await createMatch({ homeTeam: "Scheduled", status: "scheduled", startTime: new Date(now + 60_000), endTime: new Date(now + 120_000) });
    await createMatch({ homeTeam: "Finished", status: "finished", startTime: new Date(now - 120_000), endTime: new Date(now - 60_000) });

    const live = await (await getMatches(getRequest("?status=live"))).json();
    expect(live.data).toHaveLength(1);
    expect(live.data[0].homeTeam).toBe("Live");

    const scheduled = await (await getMatches(getRequest("?status=scheduled"))).json();
    expect(scheduled.data[0].homeTeam).toBe("Scheduled");

    const finished = await (await getMatches(getRequest("?status=finished"))).json();
    expect(finished.data[0].homeTeam).toBe("Finished");
  });

  it("derives status from the time window even when the stored row is stale", async () => {
    const now = Date.now();
    // Stored as `scheduled` but its window says the match is under way.
    const stale = await createMatch({
      status: "scheduled",
      startTime: new Date(now - 10 * 60_000),
      endTime: new Date(now + 50 * 60_000),
    });

    const body = await (await getMatches(getRequest())).json();
    expect(body.data[0].status).toBe("live");

    // The row is healed in the background and the transition is broadcast.
    await expect
      .poll(async () => (await prisma.match.findUnique({ where: { id: stale.id } }))?.status, { timeout: 5_000 })
      .toBe("live");

    const transitions = emitsFor(SOCKET_EVENTS.matchStatus);
    expect(transitions.some((entry) => (entry.payload as { matchId: number }).matchId === stale.id)).toBe(true);
  });

  it("serialises timestamps as ISO strings", async () => {
    await createMatch();
    const body = await (await getMatches(getRequest())).json();
    expect(body.data[0].startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => JSON.parse(JSON.stringify(body))).not.toThrow();
  });
});

describe("POST /api/matches", () => {
  it("creates a fixture, derives its status and broadcasts match:created", async () => {
    const response = await postMatch(postRequest(validPayload()));
    expect(response.status).toBe(201);

    const { data } = await response.json();
    expect(data).toMatchObject({ sport: "football", homeTeam: "Arsenal", homeScore: 0, awayScore: 0 });
    // startTime is 5 minutes in the past, so the fixture must register as live.
    expect(data.status).toBe("live");

    const stored = await prisma.match.findUnique({ where: { id: data.id } });
    expect(stored?.status).toBe("live");

    const created = emitsFor(SOCKET_EVENTS.matchCreated);
    expect(created).toHaveLength(1);
    expect((created[0].payload as { id: number }).id).toBe(data.id);
    // Broadcast globally, not to a room.
    expect(created[0].room).toBeNull();
  });

  it("creates a scheduled fixture when the window is in the future", async () => {
    const now = Date.now();
    const response = await postMatch(
      postRequest({
        ...validPayload(),
        startTime: new Date(now + 60 * 60_000).toISOString(),
        endTime: new Date(now + 120 * 60_000).toISOString(),
      })
    );
    expect((await response.json()).data.status).toBe("scheduled");
  });

  it("ignores a client-supplied status", async () => {
    const response = await postMatch(postRequest({ ...validPayload(), status: "finished" }));
    expect((await response.json()).data.status).toBe("live");
  });

  it.each([
    ["missing sport", { ...validPayload(), sport: undefined }],
    ["unknown sport", { ...validPayload(), sport: "quidditch" }],
    ["missing team", { ...validPayload(), awayTeam: "" }],
    [
      "end before start",
      {
        ...validPayload(),
        startTime: new Date(Date.now() + 120 * 60_000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    ],
    ["negative score", { ...validPayload(), homeScore: -3 }],
    ["bad date", { ...validPayload(), startTime: "yesterday" }],
  ])("rejects %s with a structured 400", async (_label, payload) => {
    const response = await postMatch(postRequest(payload, `10.0.0.${Math.floor(Math.random() * 200) + 10}`));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("rejects a malformed JSON body", async () => {
    const request = new NextRequest(new URL("http://localhost:3000/api/matches"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.1.1.1" },
      body: "{not json",
    });
    const response = await postMatch(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-JSON content type", async () => {
    const request = new NextRequest(new URL("http://localhost:3000/api/matches"), {
      method: "POST",
      headers: { "content-type": "text/plain", "x-forwarded-for": "10.1.1.2" },
      body: JSON.stringify(validPayload()),
    });
    expect((await postMatch(request)).status).toBe(400);
  });

  it("rate limits a flood of fixture creation", async () => {
    const ip = "10.9.9.9";
    const limit = env.RATE_LIMIT_MATCH_CREATE;
    let limited = false;

    // One request beyond the budget must be rejected.
    for (let index = 0; index < limit + 1; index += 1) {
      const response = await postMatch(postRequest(validPayload(), ip));
      if (response.status === 429) {
        limited = true;
        expect((await response.json()).error.code).toBe("RATE_LIMITED");
        break;
      }
    }

    expect(limited, `expected the ${limit}/minute limiter to engage`).toBe(true);
  });
});
