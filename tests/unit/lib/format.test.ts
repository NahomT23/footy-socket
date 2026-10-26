import { describe, expect, it } from "vitest";

import {
  displayScore,
  formatOvers,
  eventBadgeClass,
  eventBadgeLabel,
  formatFullTimestamp,
  formatKickoff,
  formatMinute,
  formatRelative,
  isLive,
  resultLabel,
  scoreLine,
  SPORT_EMOJI,
  STATUS_LABEL,
  teamInitials,
} from "@/lib/format";
import type { Match } from "@/lib/types";

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 1,
  sport: "football",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  status: "live",
  startTime: new Date().toISOString(),
  endTime: new Date(Date.now() + 3_600_000).toISOString(),
  homeScore: 2,
  awayScore: 1,
  homeWickets: 0,
  awayWickets: 0,
  homeInnings: 0,
  awayInnings: 0,
    homeOvers: null,
    awayOvers: null,
    result: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("formatKickoff", () => {
  it("labels a fixture later today with its local time", () => {
    const today = new Date();
    today.setHours(23, 30, 0, 0);
    expect(formatKickoff(today.toISOString())).toMatch(/^Today /);
  });

  it("labels another day with the weekday and date", () => {
    const future = new Date(Date.now() + 5 * 24 * 3_600_000);
    const label = formatKickoff(future.toISOString());
    expect(label).not.toMatch(/^Today/);
    expect(label.length).toBeGreaterThan(4);
  });

  it("falls back to TBC for an invalid date", () => {
    expect(formatKickoff("not-a-date")).toBe("TBC");
  });
});

describe("formatFullTimestamp", () => {
  it("returns a readable absolute timestamp", () => {
    expect(formatFullTimestamp("2026-01-01T12:00:00.000Z")).toMatch(/2026/);
  });

  it("handles invalid input", () => {
    expect(formatFullTimestamp("nope")).toBe("Unknown time");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it.each([
    ["just now", 5, "just now"],
    ["seconds", 30, "30s ago"],
    ["minutes", 3 * 60, "3m ago"],
    ["hours", 2 * 3_600, "2h ago"],
    ["days", 3 * 86_400, "3d ago"],
  ])("renders %s buckets", (_label, secondsAgo, expected) => {
    const iso = new Date(now.getTime() - secondsAgo * 1_000).toISOString();
    expect(formatRelative(iso, now)).toBe(expected);
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelative("nope", now)).toBe("");
  });
});

describe("formatMinute", () => {
  it("appends the football apostrophe", () => {
    expect(formatMinute(45)).toBe("45'");
  });

  it("returns null for period-only sports", () => {
    expect(formatMinute(null)).toBeNull();
  });
});

describe("eventBadgeLabel", () => {
  it.each([
    ["goal", "GOAL"],
    ["wicket", "WICKET"],
    ["three", "THREE"],
    ["start", "KICK-OFF"],
    ["end", "FULL TIME"],
    ["substitution", "SUB"],
  ])("maps %s to %s", (eventType, expected) => {
    expect(eventBadgeLabel(eventType)).toBe(expected);
  });

  it("returns null when there is no event type", () => {
    expect(eventBadgeLabel(null)).toBeNull();
  });

  it("upper-cases an unknown type rather than crashing", () => {
    expect(eventBadgeLabel("somethingelse")).toBe("SOMETHINGELSE");
  });
});

describe("eventBadgeClass", () => {
  it("gives every known event type a badge style", () => {
    const types = [
      "start", "goal", "card", "basket", "three", "wicket",
      "foul", "timeout", "substitution", "stoppage", "period", "end", "info",
    ];
    for (const eventType of types) {
      expect(eventBadgeClass(eventType)).toMatch(/bg-/);
    }
  });

  it("highlights goals with the accent colour", () => {
    expect(eventBadgeClass("goal")).toContain("bg-accent");
  });

  it("falls back gracefully for null/unknown", () => {
    expect(eventBadgeClass(null)).toBe("bg-white text-ink");
    expect(eventBadgeClass("unknown")).toBe("bg-white text-ink");
  });
});

describe("teamInitials", () => {
  it.each([
    ["Arsenal", "ARS"],
    ["LA Lakers", "LL"],
    ["Real Madrid", "RM"],
    ["  ", "?"],
  ])("derives %s -> %s", (team, expected) => {
    expect(teamInitials(team)).toBe(expected);
  });
});

describe("resultLabel", () => {
  it("reports the winning side", () => {
    expect(resultLabel(match({ status: "finished", homeScore: 3, awayScore: 1 }))).toBe("Arsenal win");
    expect(resultLabel(match({ status: "finished", homeScore: 1, awayScore: 3 }))).toBe("Chelsea win");
  });

  it("reports a draw", () => {
    expect(resultLabel(match({ status: "finished", homeScore: 2, awayScore: 2 }))).toBe("Draw");
  });

  it("returns null while a match is not finished", () => {
    expect(resultLabel(match({ status: "live" }))).toBeNull();
    expect(resultLabel(match({ status: "scheduled" }))).toBeNull();
  });
});

describe("displayScore", () => {
  it("shows runs/wickets for cricket so the score is meaningful", () => {
    const cricket = match({ sport: "cricket", homeScore: 170, homeWickets: 4 });
    expect(displayScore(cricket, "home")).toBe("170/4");
  });

  it("shows a bare number for football and basketball", () => {
    expect(displayScore(match({ homeScore: 2 }), "home")).toBe("2");
    expect(displayScore(match({ sport: "basketball", awayScore: 88, awayWickets: 0 }), "away")).toBe("88");
  });

  it("distinguishes a wicket-less innings from a collapse", () => {
    const steady = match({ sport: "cricket", homeScore: 170, homeWickets: 0 });
    const collapse = match({ sport: "cricket", homeScore: 170, homeWickets: 9 });
    expect(displayScore(steady, "home")).not.toBe(displayScore(collapse, "home"));
  });
});

describe("formatOvers", () => {
  it("labels overs with a unit", () => {
    expect(formatOvers("31.4")).toBe("31.4 ov");
  });

  it("returns null when overs are unknown", () => {
    expect(formatOvers(null)).toBeNull();
    expect(formatOvers(undefined)).toBeNull();
    expect(formatOvers("")).toBeNull();
  });
});

describe("resultLabel for cricket", () => {
  it("calls a level cricket match a tie rather than a draw", () => {
    expect(resultLabel(match({ sport: "cricket", status: "finished", homeScore: 172, awayScore: 172 }))).toBe(
      "Match tied"
    );
  });

  it("still calls a level football match a draw", () => {
    expect(resultLabel(match({ status: "finished", homeScore: 2, awayScore: 2 }))).toBe("Draw");
  });
});

describe("scoreLine", () => {
  it("uses the cricket score format in summaries", () => {
    const cricket = match({ sport: "cricket", homeScore: 247, homeWickets: 6, awayScore: 172, awayWickets: 8 });
    expect(scoreLine(cricket)).toBe("Arsenal 247/6 – 172/8 Chelsea");
  });

  it("summarises the score with both teams", () => {
    expect(scoreLine(match())).toBe("Arsenal 2 – 1 Chelsea");
  });
});

describe("isLive", () => {
  it("is true only for live fixtures", () => {
    expect(isLive(match({ status: "live" }))).toBe(true);
    expect(isLive(match({ status: "scheduled" }))).toBe(false);
    expect(isLive(match({ status: "finished" }))).toBe(false);
  });
});

describe("static label maps", () => {
  it("covers every supported sport", () => {
    expect(Object.keys(SPORT_EMOJI)).toEqual(["football", "cricket", "basketball"]);
  });

  it("covers every lifecycle state", () => {
    expect(STATUS_LABEL).toEqual({ scheduled: "Scheduled", live: "Live", finished: "Finished" });
  });
});
