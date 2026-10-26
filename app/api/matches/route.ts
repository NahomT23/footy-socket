import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { ERROR_CODES, clientKey, fail, guard, ok, rateLimit, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeMatch } from "@/lib/serializers";
import { emitMatchCreated } from "@/lib/socket-server";
import { deriveStatus } from "@/lib/match-status";
import { createMatchSchema, limitQuerySchema, toIssues } from "@/lib/validations";
import { listMatches } from "@/lib/queries";

/**
 * GET /api/matches
 *
 * Supports `?limit=` (default 50, max 100) and `?status=` filters. Status is
 * derived from start/end times against the current instant, so a fixture moves
 * scheduled -> live -> finished even if nobody wrote to the row.
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const params = request.nextUrl.searchParams;
    const parsedLimit = limitQuerySchema.safeParse(params.get("limit") ?? undefined);

    if (!parsedLimit.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid limit query parameter", toIssues(parsedLimit.error));
    }

    const matches = await listMatches(parsedLimit.data);
    const status = params.get("status");

    const filtered =
      status === "scheduled" || status === "live" || status === "finished"
        ? matches.filter((match) => match.status === status)
        : matches;

    return ok(filtered);
  });
}

/**
 * POST /api/matches
 *
 * Schedules a new fixture. The row is persisted first and broadcast second: a
 * client that misses `match:created` still finds the match on its next fetch.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const limited = rateLimit(clientKey(request, "match:create"), {
      limit: env.RATE_LIMIT_MATCH_CREATE,
      windowMs: 60_000,
    });
    if (!limited.allowed) {
      return fail(
        ERROR_CODES.RATE_LIMITED,
        `Too many matches created. Retry in ${Math.ceil(limited.retryAfterMs / 1000)}s.`
      );
    }

    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsed = createMatchSchema.safeParse(body.value);
    if (!parsed.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid match payload", toIssues(parsed.error));
    }

    const {
      sport,
      homeTeam,
      awayTeam,
      startTime,
      endTime,
      homeScore,
      awayScore,
      homeWickets,
      awayWickets,
      homeInnings,
      awayInnings,
      result,
    } = parsed.data;

    const created = await prisma.match.create({
      data: {
        sport,
        homeTeam,
        awayTeam,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        homeScore,
        awayScore,
        // Cricket detail; forced to 0 for other sports so the columns stay
        // meaningful (a football scoreline must never read "2/3").
        homeWickets: sport === "cricket" ? homeWickets : 0,
        awayWickets: sport === "cricket" ? awayWickets : 0,
        homeInnings: sport === "cricket" ? homeInnings : 0,
        awayInnings: sport === "cricket" ? awayInnings : 0,
        result: result ?? null,
        // Never trust a client-supplied status: derive it from the time window.
        status: deriveStatus(startTime, endTime),
      },
    });

    const match = serializeMatch(created);

    try {
      emitMatchCreated(match);
    } catch (error) {
      // Realtime fan-out is best-effort; the write already succeeded.
      console.error("[api] failed to broadcast match:created", error);
    }

    return ok(match, 201);
  });
}

