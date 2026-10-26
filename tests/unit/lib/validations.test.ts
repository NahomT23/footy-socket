import { describe, expect, it } from "vitest";

import {
  createCommentarySchema,
  createMatchSchema,
  idParamSchema,
  joinMatchSchema,
  limitQuerySchema,
  toIssues,
  updateScoreSchema,
} from "@/lib/validations";

/**
 * These schemas are the contract shared by the REST API and the Socket.IO
 * layer, so they are tested in isolation from both.
 */
describe("idParamSchema", () => {
  it("coerces numeric strings", () => {
    expect(idParamSchema.parse("42")).toBe(42);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["not a number", "abc"],
    ["empty", ""],
    ["beyond int4", String(2 ** 31)],
  ])("rejects %s", (_label, value) => {
    expect(idParamSchema.safeParse(value).success).toBe(false);
  });
});

describe("limitQuerySchema", () => {
  it("defaults to 50 when absent", () => {
    expect(limitQuerySchema.parse(undefined)).toBe(50);
  });

  it("accepts the documented maximum of 100", () => {
    expect(limitQuerySchema.parse("100")).toBe(100);
  });

  it("rejects values above the cap", () => {
    expect(limitQuerySchema.safeParse("101").success).toBe(false);
  });

  it("rejects zero and negatives", () => {
    expect(limitQuerySchema.safeParse("0").success).toBe(false);
    expect(limitQuerySchema.safeParse("-1").success).toBe(false);
  });
});

describe("createMatchSchema", () => {
  const valid = {
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    startTime: "2026-01-01T12:00:00.000Z",
    endTime: "2026-01-01T14:00:00.000Z",
  };

  it("accepts a well-formed fixture and defaults scores to 0", () => {
    const parsed = createMatchSchema.parse(valid);
    expect(parsed.homeScore).toBe(0);
    expect(parsed.awayScore).toBe(0);
  });

  it("trims whitespace from team names", () => {
    const parsed = createMatchSchema.parse({ ...valid, homeTeam: "  Arsenal  " });
    expect(parsed.homeTeam).toBe("Arsenal");
  });

  it("rejects an unknown sport", () => {
    const result = createMatchSchema.safeParse({ ...valid, sport: "quidditch" });
    expect(result.success).toBe(false);
  });

  it("rejects an end time before the start time", () => {
    const result = createMatchSchema.safeParse({
      ...valid,
      startTime: "2026-01-01T14:00:00.000Z",
      endTime: "2026-01-01T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toIssues(result.error).some((issue) => issue.path === "endTime")).toBe(true);
    }
  });

  it("rejects an end time equal to the start time", () => {
    const result = createMatchSchema.safeParse({ ...valid, endTime: valid.startTime });
    expect(result.success).toBe(false);
  });

  it("rejects a team playing itself", () => {
    const result = createMatchSchema.safeParse({ ...valid, awayTeam: "Arsenal" });
    expect(result.success).toBe(false);
  });

  it("rejects unparseable dates", () => {
    expect(createMatchSchema.safeParse({ ...valid, startTime: "not-a-date" }).success).toBe(false);
  });

  it("rejects a negative score", () => {
    expect(createMatchSchema.safeParse({ ...valid, homeScore: -1 }).success).toBe(false);
  });

  it("accepts every supported sport", () => {
    for (const sport of ["football", "cricket", "basketball"]) {
      expect(createMatchSchema.safeParse({ ...valid, sport }).success).toBe(true);
    }
  });
});

describe("updateScoreSchema", () => {
  it("accepts non-negative integers", () => {
    expect(updateScoreSchema.parse({ homeScore: 2, awayScore: 0 })).toEqual({
      homeScore: 2,
      awayScore: 0,
    });
  });

  it("rejects strings (the socket/HTTP boundary must be typed)", () => {
    expect(updateScoreSchema.safeParse({ homeScore: "2", awayScore: 0 }).success).toBe(false);
  });

  it("rejects negatives, fractions and missing fields", () => {
    expect(updateScoreSchema.safeParse({ homeScore: -1, awayScore: 0 }).success).toBe(false);
    expect(updateScoreSchema.safeParse({ homeScore: 1.5, awayScore: 0 }).success).toBe(false);
    expect(updateScoreSchema.safeParse({ homeScore: 1 }).success).toBe(false);
  });
});

describe("createCommentarySchema", () => {
  const valid = { message: "GOAL! Saka finishes the counter." };

  it("accepts a minimal entry and defaults tags to []", () => {
    const parsed = createCommentarySchema.parse(valid);
    expect(parsed.tags).toEqual([]);
    expect(parsed.eventType).toBeUndefined();
  });

  it("accepts nulls for every optional field", () => {
    const parsed = createCommentarySchema.parse({
      ...valid,
      minute: null,
      sequence: null,
      period: null,
      eventType: null,
      actor: null,
      team: null,
      metadata: null,
    });
    expect(parsed.minute).toBeNull();
  });

  it("rejects an empty message", () => {
    expect(createCommentarySchema.safeParse({ message: "   " }).success).toBe(false);
  });

  it("rejects an unknown event type (closed vocabulary)", () => {
    expect(createCommentarySchema.safeParse({ ...valid, eventType: "touchdown" }).success).toBe(false);
  });

  it("accepts every supported event type", () => {
    const types = [
      "start", "goal", "card", "basket", "three", "wicket",
      "foul", "timeout", "substitution", "stoppage", "period", "end", "info",
    ];
    for (const eventType of types) {
      expect(createCommentarySchema.safeParse({ ...valid, eventType }).success).toBe(true);
    }
  });

  it("rejects an out-of-range minute", () => {
    expect(createCommentarySchema.safeParse({ ...valid, minute: -1 }).success).toBe(false);
    expect(createCommentarySchema.safeParse({ ...valid, minute: 2000 }).success).toBe(false);
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: 13 }, (_, index) => `tag${index}`);
    expect(createCommentarySchema.safeParse({ ...valid, tags }).success).toBe(false);
  });

  it("accepts arbitrary metadata objects", () => {
    const parsed = createCommentarySchema.parse({
      ...valid,
      metadata: { xg: 0.31, over: "18.2", nested: { a: 1 } },
    });
    expect(parsed.metadata).toEqual({ xg: 0.31, over: "18.2", nested: { a: 1 } });
  });
});

describe("joinMatchSchema", () => {
  it("coerces a numeric string matchId", () => {
    expect(joinMatchSchema.parse({ matchId: "7" })).toEqual({ matchId: 7 });
  });

  it("rejects a missing or invalid matchId", () => {
    expect(joinMatchSchema.safeParse({}).success).toBe(false);
    expect(joinMatchSchema.safeParse({ matchId: "abc" }).success).toBe(false);
    expect(joinMatchSchema.safeParse(null).success).toBe(false);
  });
});

describe("toIssues", () => {
  it("flattens nested paths and labels the root", () => {
    const result = createMatchSchema.safeParse({ sport: "football" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = toIssues(result.error);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => typeof issue.path === "string" && issue.message)).toBe(true);
    }
  });
});
