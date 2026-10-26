/**
 * ESPN adapter tests.
 *
 * These golden fixtures are distilled from real `site.api.espn.com` responses
 * (fields trimmed to what the normalizer consumes). If ESPN ever changes
 * shape, these tests are the loud alarm that tells us the adapter needs a
 * re-record instead of the dashboard silently going stale.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LEAGUES_SPEC,
  fetchScoreboard,
  fetchSummary,
  parseLeagues,
  yyyymmdd,
} from "@/lib/providers/espn.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }))
  );
}

describe("parseLeagues", () => {
  it("parses the default spec into sport/slug pairs", () => {
    const { leagues, warnings } = parseLeagues();
    expect(leagues).toEqual([
      { sport: "football", slug: "eng.1" },
      { sport: "football", slug: "esp.1" },
      { sport: "basketball", slug: "nba" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("rejects unknown sports instead of crashing the poll loop", () => {
    const { leagues, warnings } = parseLeagues("football:eng.1,hockey:nhl,nonsense");
    expect(leagues).toEqual([{ sport: "football", slug: "eng.1" }]);
    expect(warnings).toEqual(["hockey:nhl", "nonsense"]);
  });

  it("exports a sensible default", () => {
    expect(DEFAULT_LEAGUES_SPEC).toContain("football:eng.1");
    expect(DEFAULT_LEAGUES_SPEC).toContain("basketball:nba");
  });
});

describe("yyyymmdd", () => {
  it("formats for the ?dates= parameter", () => {
    expect(yyyymmdd(new Date("2026-10-25T14:00:00Z"))).toBe("20261025");
  });
});

describe("fetchScoreboard — soccer", () => {
  const GOLDEN = {
    leagues: [{ name: "English Premier League" }],
    events: [
      {
        id: "401879254",
        date: "2026-10-25T14:00:00Z",
        status: { type: { state: "post", detail: "FT" } },
        competitions: [
          {
            competitors: [
              {
                homeAway: "home",
                score: "0",
                team: { id: "384", abbreviation: "CRY", displayName: "Crystal Palace" },
              },
              {
                homeAway: "away",
                score: "2",
                team: { id: "361", abbreviation: "NEW", displayName: "Newcastle United" },
              },
            ],
            details: [
              {
                type: { text: "Goal" },
                scoringPlay: true,
                penaltyKick: false,
                ownGoal: false,
                team: { id: "361" },
                clock: { value: 2810, displayValue: "47'" },
                athletesInvolved: [{ displayName: "William Osula" }],
              },
              {
                type: { text: "Yellow Card" },
                scoringPlay: false,
                team: { id: "384" },
                clock: { displayValue: "45'+1'" },
                athletesInvolved: [],
              },
            ],
          },
        ],
      },
      {
        id: "401879255",
        date: "2026-10-25T16:30:00Z",
        status: { type: { state: "pre", detail: "" }, period: 0 },
        competitions: [
          {
            competitors: [
              {
                homeAway: "home",
                score: "",
                team: { id: "1", abbreviation: "ARS", displayName: "Arsenal" },
              },
              {
                homeAway: "away",
                score: "",
                team: { id: "2", abbreviation: "MCI", displayName: "Manchester City" },
              },
            ],
            details: [],
          },
        ],
      },
    ],
  };

  it("normalises finished/scheduled fixtures into row-shaped records", async () => {
    stubFetch(GOLDEN);
    const { matches, eventsByExternalId } = await fetchScoreboard(
      { sport: "football", slug: "eng.1" },
      new Date("2026-10-25T00:00:00Z")
    );

    expect(matches).toHaveLength(2);

    const finished = matches[0];
    expect(finished.externalId).toBe("eng.1:401879254");
    expect(finished.status).toBe("finished");
    expect(finished.homeTeam).toBe("Crystal Palace");
    expect(finished.homeScore).toBe(0);
    expect(finished.awayScore).toBe(2);
    // The Date is a plain ISO string, ready for Prisma without conversion.
    expect(typeof finished.startTime).toBe("string");
    expect(new Date(finished.endTime).getTime()).toBeGreaterThan(
      new Date(finished.startTime).getTime()
    );
    // Finished games state the outcome explicitly.
    expect(finished.result).toBe("Newcastle United win 0-2");

    const scheduled = matches[1];
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.homeScore).toBe(0); // "" -> 0, not NaN
    expect(scheduled.result).toBeNull();
  });

  it("turns scoring plays into feed entries with a scorer and the right minute", async () => {
    stubFetch(GOLDEN);
    const { matches, eventsByExternalId } = await fetchScoreboard(
      { sport: "football", slug: "eng.1" },
      new Date("2026-10-25T00:00:00Z")
    );

    const entries = eventsByExternalId.get("eng.1:401879254");
    expect(entries).toHaveLength(2);

    const goal = entries[0];
    expect(goal.eventType).toBe("goal");
    expect(goal.actor).toBe("William Osula");
    expect(goal.minute).toBe(47);
    expect(goal.team).toBe("NEW");
    expect(goal.message).toContain("GOAL!");

    const card = entries[1];
    expect(card.eventType).toBe("card");
    // Stoppage folds into the base minute.
    expect(card.minute).toBe(45);
  });
});

describe("fetchSummary — basketball", () => {
  const GOLDEN = {
    plays: [
      { sequenceNumber: "4", type: { text: "Start Period" }, period: { displayValue: "1st Quarter" }, text: "" },
      { sequenceNumber: "5", type: { text: "Miss Jump Shot" }, scoringPlay: false, text: "Missed" },
      {
        sequenceNumber: "12",
        type: { text: "3-pt Jump Shot" },
        scoringPlay: true,
        scoreValue: 3,
        text: "S. Curry makes 26-foot three point jump shot",
        clock: { displayValue: "8.4" },
        period: { displayValue: "1st Quarter" },
        participants: [{ athlete: { displayName: "Stephen Curry" } }],
      },
      {
        sequenceNumber: "40",
        type: { text: "End Game" },
        period: { displayValue: "4th Quarter" },
        scoringPlay: false,
      },
    ],
  };

  it("keeps scoring plays and period breaks, drops filler", async () => {
    stubFetch(GOLDEN);
    const { commentary, lastSequence } = await fetchSummary({
      sport: "basketball",
      slug: "nba",
      eventId: "401909861",
    });

    expect(commentary.map((entry) => entry.sequence)).toEqual([4, 12, 40]);
    expect(commentary[1].eventType).toBe("three");
    expect(commentary[1].actor).toBe("Stephen Curry");
    expect(commentary[2].eventType).toBe("info"); // period break, not a basket
    expect(lastSequence).toBe(40);
  });
});
