/**
 * Presentation-only helpers. No component imports React from here so this file
 * can also be used from the server component that renders the first paint.
 */
import type { EventType, Match, MatchStatus, Sport } from "@/lib/types";

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const TIME_ONLY = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export const SPORT_EMOJI: Record<Sport, string> = {
  football: "⚽",
  cricket: "🏏",
  basketball: "🏀",
};

export const SPORT_LABEL: Record<Sport, string> = {
  football: "Football",
  cricket: "Cricket",
  basketball: "Basketball",
};

export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  finished: "Finished",
};

/** Kickoff in the *viewer's* timezone (the spec requires local times). */
export function formatKickoff(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBC";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? `Today ${TIME_ONLY.format(date)}` : `${WEEKDAY.format(date)} ${DATE_TIME.format(date)}`;
}

/** Exact local timestamp, used as a `title` tooltip. */
export function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(date);
}

/** "just now" / "3m ago" / "2h ago" for feed entries. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/** Game clock, e.g. `45'`. */
export function formatMinute(minute: number | null): string | null {
  return minute === null ? null : `${minute}'`;
}

/** Uppercase badge text for an event type. */
export function eventBadgeLabel(eventType: string | null): string | null {
  if (!eventType) return null;
  const labels: Record<EventType, string> = {
    start: "KICK-OFF",
    goal: "GOAL",
    card: "CARD",
    basket: "BASKET",
    three: "THREE",
    wicket: "WICKET",
    foul: "FOUL",
    timeout: "TIMEOUT",
    substitution: "SUB",
    stoppage: "STOPPAGE",
    period: "PERIOD",
    end: "FULL TIME",
    info: "INFO",
  };
  return labels[eventType as EventType] ?? eventType.toUpperCase();
}

/** Tailwind classes per event type — yellow/blue accents from the design system. */
export function eventBadgeClass(eventType: string | null): string {
  switch (eventType) {
    case "goal":
      return "bg-accent text-ink";
    case "basket":
    case "three":
      return "bg-soft text-ink";
    case "wicket":
      return "bg-danger text-white";
    case "card":
    case "foul":
    case "timeout":
      return "bg-ink text-white";
    case "start":
    case "end":
      return "bg-success text-white";
    case "substitution":
    case "period":
      return "bg-white text-ink";
    default:
      return "bg-white text-ink";
  }
}

/** Short "HOM 2 – 1 AWY" style summary used in toasts and titles. */
export function scoreLine(match: Match): string {
  return `${match.homeTeam} ${displayScore(match, "home")} – ${displayScore(match, "away")} ${match.awayTeam}`;
}

/**
 * The score as a user reads it.
 *
 * Cricket is always `runs/wickets` — showing bare runs would be actively
 * misleading, because 170/0 and 170/9 describe completely different matches.
 */
export function displayScore(match: Match, side: "home" | "away"): string {
  const runs = side === "home" ? match.homeScore : match.awayScore;
  const wickets = side === "home" ? match.homeWickets : match.awayWickets;
  return match.sport === "cricket" ? `${runs}/${wickets}` : String(runs);
}

/** Overs completed, carried in score-broadcast metadata rather than the row. */
export function formatOvers(overs: string | null | undefined): string | null {
  if (!overs) return null;
  return `${overs} ov`;
}

/** Fallback so a 3-letter code is always visible next to the full team name. */
export function teamInitials(team: string): string {
  const words = team.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** True when the match can still receive score updates. */
export function isLive(match: Match): boolean {
  return match.status === "live";
}

/**
 * Human summary of how a match ended, for finished cards.
 *
 * A stored `result` always wins. It is authoritative for cricket, where the two
 * sides' totals come from different innings, and for any sport where the
 * scoreline alone cannot express the outcome (a chase, a draw on aggregate).
 * The scoreline fallback only covers fixtures that predate the field.
 */
export function resultLabel(match: Match): string | null {
  if (match.status !== "finished") return null;
  if (match.result) return match.result;

  if (match.homeScore === match.awayScore) {
    // A level cricket match is "tied"; only football and basketball draw.
    return match.sport === "cricket" ? "Match tied" : "Draw";
  }
  return match.homeScore > match.awayScore ? `${match.homeTeam} win` : `${match.awayTeam} win`;
}
