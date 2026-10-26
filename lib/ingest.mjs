/**
 * Ingest engine: provider data -> Prisma -> Socket.IO.
 *
 * Mirrors the shape of the simulator (`scripts/seed.mjs`) but reads reality
 * instead of authoring it. Everything here is idempotent per
 * (providerKey, externalId) — a poll that partially fails is simply retried
 * on the next cycle.
 *
 * Plain Node ESM: imported by `server.mjs`, same constraints as the rest of
 * the runtime layer. It uses the same prisma/io instances the server holds.
 *
 * Safety rails baked in:
 *   - one scoreboard request per league per cycle, plus one summary request
 *     per live NBA fixture (bounded by how many games are on)
 *   - exponential circuit breaker: 2 consecutive provider failures pause that
 *     league for a cool-off period; a dead provider never becomes a request
 *     storm
 *   - everything is wrapped so an ingest error can never take the server down
 *     (same philosophy as the status sweeper)
 */
import { DEFAULT_LEAGUES_SPEC, fetchScoreboard, fetchSummary, parseLeagues, yyyymmdd } from "./providers/espn.mjs";

const PROVIDER_KEY = "espn";

const INGEST = {
  /** How often each league's scoreboard is refreshed. */
  pollIntervalMs: Number(process.env.ESPN_POLL_MS ?? 30_000),
  /** Cool-off after repeated provider failures, doubled on each new failure. */
  baseBackoffMs: 60_000,
  /** Days of history pulled at boot so the dashboard is never empty. */
  backfillDays: Number(process.env.ESPN_BACKFILL_DAYS ?? 3),
  /** Quiet gap between backfill requests, out of politeness. */
  requestGapMs: 400,
  /** NBA: fetch the play-by-play only for fixtures that are actually live. */
  summaryEnabled: process.env.ESPN_SUMMARY_DISABLED !== "true",
};

/** Millisecond-scale sleep. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node network errors often carry their detail in `.cause` (undici) rather
 * than `.message`, so surface everything: an upstream outage must tell us
 * whether it's a timeout, DNS, 400 or a socket reset.
 */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeText = cause
    ? ` (cause: ${typeof cause === "object" ? `${cause.code ?? cause.name ?? "unknown"} — ${cause.message ?? "no detail"}` : cause})`
    : "";
  const code = typeof error.code === "string" ? ` [code=${error.code}]` : "";
  return `${error.name}: ${error.message || "no message"}${code}${causeText}`;
}

/**
 * Runs one provider cycle for one league: fetch -> persist -> emit.
 * Returns the number of fixtures touched. Throws on provider failure so the
 * caller can count it against the breaker.
 */
export async function syncLeague({ prisma, io, events, league, day }) {
  const { matches, eventsByExternalId } = await fetchScoreboard(
    league,
    day,
    10_000
  );

  const externalIds = matches.map((match) => match.externalId);
  if (externalIds.length === 0) return 0;

  const known = await prisma.match.findMany({
    where: { providerKey: PROVIDER_KEY, externalId: { in: externalIds } },
    select: { id: true, externalId: true, status: true, homeScore: true, awayScore: true },
  });
  const byExternalId = new Map(known.map((row) => [row.externalId, row]));

  const changedScores = [];
  const changedStatuses = [];
  const created = [];

  for (const match of matches) {
    const existing = byExternalId.get(match.externalId);

    if (!existing) {
      const row = await prisma.match.create({
        data: {
          providerKey: PROVIDER_KEY,
          externalId: match.externalId,
          competition: match.competition,
          sport: match.sport,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          status: match.status,
          startTime: new Date(match.startTime),
          endTime: new Date(match.endTime),
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          result: match.result,
        },
      });
      created.push({ ...match, id: row.id });
      continue;
    }

    if (
      existing.homeScore !== match.homeScore ||
      existing.awayScore !== match.awayScore
    ) {
      changedScores.push({ existing, match });
    }
    if (existing.status !== match.status) {
      changedStatuses.push({ existing, match });
      await prisma.match.update({
        where: { id: existing.id },
        data: {
          status: match.status,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          result: match.result,
        },
      });
    } else if (changedScores.some((entry) => entry.existing.id === existing.id)) {
      await prisma.match.update({
        where: { id: existing.id },
        data: { homeScore: match.homeScore, awayScore: match.awayScore },
      });
    }
  }

  /* -- emission: identical payloads to what the server itself sends -------- */

  for (const match of created) {
    io.emit(events.matchCreated, {
      ...match,
      homeWickets: 0,
      awayWickets: 0,
      homeInnings: 0,
      awayInnings: 0,
      homeOvers: null,
      awayOvers: null,
      result: match.result,
      createdAt: new Date().toISOString(),
    });
  }

  for (const { existing, match } of changedScores) {
    io.to(matchRoom(existing.id)).emit(events.matchScore, {
      matchId: existing.id,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeWickets: 0,
      awayWickets: 0,
      homeOvers: null,
      awayOvers: null,
    });
  }

  for (const { existing, match } of changedStatuses) {
    io.emit(events.matchStatus, {
      matchId: existing.id,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeWickets: 0,
      awayWickets: 0,
    });
    // Mirror the sweeper: finished fixtures drop their room so idle clients
    // stop getting traffic.
    if (match.status === "finished") {
      io.in(matchRoom(existing.id)).socketsLeave(matchRoom(existing.id));
    }
  }

  /* -- commentary ---------------------------------------------------------- */

  for (const [externalId, entries] of eventsByExternalId) {
    const match = matches.find((entry) => entry.externalId === externalId);
    const known = byExternalId.get(externalId);
    const id = known?.id ?? created.find((row) => row.externalId === externalId)?.id;
    if (!id || entries.length === 0) continue;

    await storeCommentary({ prisma, io, events, matchId: id, entries });
  }

  return created.length;
}

/** Socket.IO room name — mirrored from lib/types.ts, see check:contract. */
function matchRoom(matchId) {
  return `match:${matchId}`;
}

/**
 * Dedupe-free commentary store. Each entry already carries its provider
 * sequence; rows that fail the (matchId, sequence) unique constraint are the
 * ones we've already shown, so we filter them before writing and emit only
 * true newcomers.
 */
async function storeCommentary({ prisma, io, events, matchId, entries }) {
  const existingRows = await prisma.commentary.findMany({
    where: { matchId },
    select: { sequence: true },
  });
  const knownSequences = new Set(existingRows.map((row) => row.sequence));

  const fresh = entries.filter((entry) => !knownSequences.has(entry.sequence));
  if (fresh.length === 0) return [];

  const stored = [];
  for (const [index, entry] of fresh.entries()) {
    let row;
    try {
      row = await prisma.commentary.create({
        data: {
          matchId,
          sequence: entry.sequence,
          minute: entry.minute,
          period: entry.period,
          eventType: entry.eventType,
          actor: entry.actor,
          team: entry.team,
          message: entry.message,
          metadata: entry.metadata,
          tags: [],
        },
      });
    } catch (error) {
      // A race between two poll cycles is possible but harmless: the row is
      // already in the DB, the next cycle won't retry that sequence.
      if (error?.code !== "P2002") throw error;
      continue;
    }

      const payload = {
      id: row.id,
      matchId,
      sequence: row.sequence,
      minute: row.minute,
      period: row.period,
      eventType: row.eventType,
      actor: row.actor,
      team: row.team,
      message: row.message,
      metadata: row.metadata,
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
    };

    io.to(matchRoom(matchId)).emit(events.matchCommentary, payload);
    stored.push(payload);
  }

  return stored;
}

/**
 * NBA live commentary: one summary request per live fixture per cycle.
 * The response carries a full play stream; `sinceSequence` skips plays we've
 * already ingested this process's lifetime.
 */
export async function syncLiveSummaries({ prisma, io, events, league, lastSequenceMap }) {
  if (INGEST.summaryEnabled === false) return;

  const live = await prisma.match.findMany({
    where: { providerKey: PROVIDER_KEY, status: "live", sport: league.sport },
    select: { id: true, externalId: true },
  });

  for (const match of live) {
    const [, eventId] = match.externalId.split(":");
    try {
      const { commentary, lastSequence } = await fetchSummary(
        { sport: league.sport, slug: league.slug, eventId },
        10_000
      );

      const since = lastSequenceMap.get(match.externalId) ?? -1;
      const fresh = commentary.filter((entry) => entry.sequence > since);
      if (fresh.length > 0) {
        await storeCommentary({ prisma, io, events, matchId: match.id, entries: fresh });
      }
      lastSequenceMap.set(match.externalId, lastSequence);
    } catch (error) {
      console.warn(`[ingest] summary for ${match.externalId} failed: ${describeError(error)}`);
    }
    await sleep(INGEST.requestGapMs);
  }
}

/**
 * Boot: purges rows from other modes so exactly one dataset appears, resets
 * any stale breaker state? (breaker lives per-league below), then schedules
 * one poll loop per league with a circuit breaker against provider outages.
 */
export function startIngest({ prisma, io, events }) {
  const { leagues, warnings } = parseLeagues(process.env.ESPN_LEAGUES ?? DEFAULT_LEAGUES_SPEC);

  // One provider owns the dataset at a time: switching SPORTS_DATA between
  // "espn" and "sim" wipes the other side's rows instead of interleaving two
  // contradictory views of the world.
  prisma.match
    .deleteMany({ where: { providerKey: { not: PROVIDER_KEY } } })
    .then((result) => {
      if (result.count > 0) {
        console.log(`[ingest] removed ${result.count} row(s) from other providers`);
      }
    })
    .catch(() => {});

  for (const warning of warnings) {
    console.warn(`[ingest] ignoring unsupported league spec "${warning}"`);
  }
  if (leagues.length === 0) {
    console.warn("[ingest] no leagues configured — provider ingest idle");
    return () => {};
  }

  const timers = new Set();
  const breaker = new Map(); // league slug -> backoff multiplier state
  const lastSequenceMap = new Map(); // externalId -> last summary sequence

  /** Boot backfill: today inclusive, then INGEST.backfillDays backwards. */
  const backfill = async () => {
    for (let offset = 0; offset <= INGEST.backfillDays; offset += 1) {
      const day = new Date(Date.now() - offset * 86_400_000);
      for (const league of leagues) {
        try {
          const created = await syncLeague({ prisma, io, events, league, day });
          console.log(
            `[ingest] ${league.sport}:${league.slug} ${yyyymmdd(day)} — ${created} new fixture(s)`
          );
        } catch (error) {
          console.warn(`[ingest] backfill ${league.sport}:${league.slug}: ${describeError(error)}`);
        }
        await sleep(INGEST.requestGapMs);
      }
    }
  };

  void backfill();

  for (const league of leagues) {
    const tick = async () => {
      const state = breaker.get(league.slug) ?? { failures: 0, next: 0 };
      const now = Date.now();
      if (now < state.next) {
        scheduleTick(tick, state.next - now, timers);
        return;
      }

      try {
        await syncLeague({ prisma, io, events, league, day: new Date() });
        if (state.failures > 0) {
          console.log(`[ingest] ${league.sport}:${league.slug} recovered`);
        }
        state.failures = 0;
        breaker.set(league.slug, state);

        await syncLiveSummaries({ prisma, io, events, league, lastSequenceMap });
      } catch (error) {
        state.failures += 1;
        const backoff = Math.min(
          INGEST.baseBackoffMs * 2 ** (state.failures - 1),
          10 * 60_000
        );
        state.next = now + backoff;
        breaker.set(league.slug, state);
        console.error(
          `[ingest] ${league.sport}:${league.slug} failed (${state.failures}x) — backing off ${Math.round(backoff / 1000)}s: ${describeError(error)}`
        );
      } finally {
        scheduleTick(
          tick,
          INGEST.pollIntervalMs + Math.floor(Math.random() * 3_000),
          timers
        );
      }
    };

    // Stagger leagues so the very first boot's calls do not pile up.
    scheduleTick(tick, 800 + (timers.size) * 2_000, timers);
  }

  return () => {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
  };
}

function scheduleTick(fn, delayMs, timers) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    void fn();
  }, delayMs);
  timer.unref?.();
}
