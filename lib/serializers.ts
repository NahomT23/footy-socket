/**
 * Serialisers: Prisma rows -> wire format.
 *
 * Prisma gives us `Date` objects and `Prisma.JsonValue`; everything that leaves
 * the process (HTTP response, socket payload) must be plain JSON. Converting in
 * one place means the client types in `lib/types.ts` are always truthful.
 */
import type { Commentary as CommentaryRow, Match as MatchRow } from "@prisma/client";

import type { Commentary, Match, MatchStatus } from "./types";

export function serializeMatch(row: MatchRow): Match {
  return {
    id: row.id,
    sport: row.sport,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    status: row.status as MatchStatus,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    homeWickets: row.homeWickets,
    awayWickets: row.awayWickets,
    homeInnings: row.homeInnings,
    awayInnings: row.awayInnings,
    homeOvers: row.homeOvers,
    awayOvers: row.awayOvers,
    result: row.result,
    competition: row.competition ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeCommentary(row: CommentaryRow): Commentary {
  return {
    id: row.id,
    matchId: row.matchId,
    minute: row.minute,
    sequence: row.sequence,
    period: row.period,
    eventType: row.eventType,
    actor: row.actor,
    team: row.team,
    message: row.message,
    metadata: normalizeMetadata(row.metadata),
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Prisma JSON columns can hold arrays, scalars, or objects. The socket contract
 * promises `Record<string, unknown> | null`, so anything else is wrapped.
 */
function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
