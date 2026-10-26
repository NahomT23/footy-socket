/**
 * Match lifecycle rules shared by the REST API, the socket layer and the UI.
 *
 * A match's status is *derived* from its time window rather than trusted from
 * the database. That makes the dashboard self-healing: even if nothing ever
 * emits `match:status`, a stale row can never be displayed as "live" forever.
 *
 * NOTE: `server.mjs` mirrors `deriveStatus` because it is plain Node ESM and
 * cannot import TypeScript. `npm run check:contract` fails the build if the two
 * implementations ever disagree.
 */
import type { MatchStatus } from "./types";

/**
 * Derives the effective status of a fixture at a given instant.
 *
 * Boundaries: the match becomes `live` exactly at `startTime` and `finished`
 * exactly at `endTime` (both inclusive of the instant they mark).
 *
 * @param startTime fixture kickoff
 * @param endTime   fixture scheduled end
 * @param now       reference instant (injectable for deterministic tests)
 */
export function deriveStatus(
  startTime: Date | string,
  endTime: Date | string,
  now: Date = new Date()
): MatchStatus {
  const start = toTime(startTime);
  const end = toTime(endTime);
  const current = now.getTime();

  if (current < start) return "scheduled";
  if (current >= end) return "finished";
  return "live";
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}
