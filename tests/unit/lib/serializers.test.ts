import { describe, expect, it, vi } from "vitest";

import { serializeCommentary, serializeMatch } from "@/lib/serializers";
import type { Commentary as CommentaryRow, Match as MatchRow } from "@prisma/client";

/** Prisma -> wire format. Clients depend on ISO strings, never `Date` objects. */
describe("serializeMatch", () => {
  const row = {
    id: 7,
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "live",
    startTime: new Date("2026-01-01T12:00:00.000Z"),
    endTime: new Date("2026-01-01T14:00:00.000Z"),
    homeScore: 2,
    awayScore: 1,
    createdAt: new Date("2026-01-01T11:00:00.000Z"),
  } as MatchRow;

  it("converts every Date to an ISO string", () => {
    const match = serializeMatch(row);
    expect(match.startTime).toBe("2026-01-01T12:00:00.000Z");
    expect(match.endTime).toBe("2026-01-01T14:00:00.000Z");
    expect(match.createdAt).toBe("2026-01-01T11:00:00.000Z");
  });

  it("is JSON-safe (round-trips through JSON.stringify)", () => {
    const parsed = JSON.parse(JSON.stringify(serializeMatch(row)));
    expect(parsed).toEqual(serializeMatch(row));
  });

  it("preserves scores and identity", () => {
    const match = serializeMatch(row);
    expect(match).toMatchObject({ id: 7, homeScore: 2, awayScore: 1, status: "live" });
  });
});

describe("serializeCommentary", () => {
  const row = {
    id: 11,
    matchId: 7,
    minute: 45,
    sequence: 3,
    period: "First Half",
    eventType: "goal",
    actor: "Bukayo Saka",
    team: "Arsenal",
    message: "GOAL!",
    metadata: { xg: 0.44 },
    tags: ["goal"],
    createdAt: new Date("2026-01-01T12:45:00.000Z"),
  } as CommentaryRow;

  it("maps the row, including structured metadata", () => {
    expect(serializeCommentary(row)).toMatchObject({
      id: 11,
      matchId: 7,
      minute: 45,
      sequence: 3,
      eventType: "goal",
      metadata: { xg: 0.44 },
      tags: ["goal"],
      createdAt: "2026-01-01T12:45:00.000Z",
    });
  });

  it("normalises null metadata to null", () => {
    expect(serializeCommentary({ ...row, metadata: null } as CommentaryRow).metadata).toBeNull();
  });

  it("wraps a scalar JSON column so the socket contract holds", () => {
    expect(serializeCommentary({ ...row, metadata: 5 } as CommentaryRow).metadata).toEqual({ value: 5 });
  });

  it("wraps an array JSON column too", () => {
    expect(serializeCommentary({ ...row, metadata: [1, 2] } as CommentaryRow).metadata).toEqual({
      value: [1, 2],
    });
  });

  it("keeps an empty object metadata as-is", () => {
    expect(serializeCommentary({ ...row, metadata: {} } as CommentaryRow).metadata).toEqual({});
  });
});

describe("environment parsing", () => {
  it("throws a helpful error when DATABASE_URL is missing", async () => {
    const original = process.env.DATABASE_URL;
    vi.resetModules();
    delete process.env.DATABASE_URL;

    await expect(import("@/lib/env")).rejects.toThrow(/DATABASE_URL/);

    process.env.DATABASE_URL = original;
    vi.resetModules();
  });

  it("rejects a non-PostgreSQL URL", async () => {
    const original = process.env.DATABASE_URL;
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://localhost/db";

    await expect(import("@/lib/env")).rejects.toThrow(/PostgreSQL/);

    process.env.DATABASE_URL = original;
    vi.resetModules();
  });
});
