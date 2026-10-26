/**
 * Read queries shared by the REST API and the server-rendered dashboard.
 *
 * Both entry points must agree on what a match's status *is*, so the status is
 * always derived here (`lib/match-status.ts`) rather than read raw from the
 * column. Stored rows that have drifted are healed in the background.
 */
import { prisma } from "./prisma";
import { deriveStatus } from "./match-status";
import { serializeCommentary, serializeMatch } from "./serializers";
import { emitMatchStatus } from "./socket-server";
import type { Commentary, Match, MatchStatus } from "./types";

interface StatusRow {
  id: number;
  providerKey: string;
  startTime: Date;
  endTime: Date;
  homeScore: number;
  awayScore: number;
  homeWickets: number;
  awayWickets: number;
  status: string;
}

/**
 * Reconciles drifted rows without blocking the caller.
 *
 * The response always reflects the *derived* status, so a slow write can never
 * delay a user-visible read; the persisted value catches up moments later and
 * the transition is broadcast as `match:status`.
 *
 * Provider rows (ESPN etc.) are exempt: their lifecycle comes from the
 * provider (a fixture can pause, go to extra time, or be delayed past any
 * estimate), so only the simulator's wall-clock rows are healed here.
 */
function healStatuses(rows: StatusRow[], derived: Map<number, MatchStatus>): void {
  const drifted = rows.filter(
    (row) => row.providerKey === "sim" && row.status !== derived.get(row.id)
  );
  if (drifted.length === 0) return;

  void Promise.allSettled(
    drifted.map((row) =>
      prisma.match
        .update({ where: { id: row.id }, data: { status: derived.get(row.id)! } })
        .then(() => {
          emitMatchStatus({
            matchId: row.id,
            status: derived.get(row.id)!,
            homeScore: row.homeScore,
            awayScore: row.awayScore,
            homeWickets: row.homeWickets,
            awayWickets: row.awayWickets,
          });
        })
    )
  );
}

/** Newest fixtures first (matches the `createdAt DESC` dashboard ordering). */
export async function listMatches(limit = 100): Promise<Match[]> {
  const rows = await prisma.match.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const now = new Date();
  const derived = new Map<number, MatchStatus>(
    rows.map((row) => [
      row.id,
      row.providerKey === "sim"
        ? deriveStatus(row.startTime, row.endTime, now)
        // Provider rows carry an authoritative status; cast to the wire union.
        : (row.status as MatchStatus),
    ])
  );
  healStatuses(rows, derived);

  return rows.map((row) =>
    serializeMatch({ ...row, status: derived.get(row.id)! as never })
  );
}

export async function findMatch(id: number): Promise<Match | null> {
  const row = await prisma.match.findUnique({ where: { id } });
  if (!row) return null;

  const derived =
    row.providerKey === "sim" ? deriveStatus(row.startTime, row.endTime) : (row.status as MatchStatus);
  healStatuses([row], new Map([[row.id, derived]]));

  return serializeMatch({ ...row, status: derived as never });
}

export async function listCommentary(matchId: number, limit = 50): Promise<Commentary[]> {
  const rows = await prisma.commentary.findMany({
    where: { matchId },
    orderBy: [{ sequence: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return rows.map(serializeCommentary);
}

/** Cheap existence check used before appending commentary. */
export async function matchExists(matchId: number): Promise<boolean> {
  const found = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true },
  });
  return found !== null;
}
