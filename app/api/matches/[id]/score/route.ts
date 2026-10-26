import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { ERROR_CODES, clientKey, fail, guard, ok, rateLimit, readJson } from "@/lib/http";
import { deriveStatus } from "@/lib/match-status";
import { prisma } from "@/lib/prisma";
import { serializeMatch } from "@/lib/serializers";
import { emitScoreUpdate } from "@/lib/socket-server";
import { idParamSchema, toIssues, updateScoreSchema } from "@/lib/validations";

/**
 * PATCH /api/matches/[id]/score
 *
 * Updates the score of a *live* fixture and fans the change out to everyone in
 * `match:{id}`. Rejecting writes to scheduled/finished matches keeps the
 * commentary feed, the score and the status coherent.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/matches/[id]/score">
) {
  return guard(async () => {
    const limited = rateLimit(clientKey(request, "match:score"), {
      limit: env.RATE_LIMIT_SCORE,
      windowMs: 60_000,
    });
    if (!limited.allowed) {
      return fail(
        ERROR_CODES.RATE_LIMITED,
        `Too many score updates. Retry in ${Math.ceil(limited.retryAfterMs / 1000)}s.`
      );
    }

    const parsedId = idParamSchema.safeParse((await ctx.params).id);
    if (!parsedId.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid match id", toIssues(parsedId.error));
    }

    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsedBody = updateScoreSchema.safeParse(body.value);
    if (!parsedBody.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid score payload", toIssues(parsedBody.error));
    }

    const matchId = parsedId.data;
    const existing = await prisma.match.findUnique({ where: { id: matchId } });

    if (!existing) {
      return fail(ERROR_CODES.NOT_FOUND, `Match ${matchId} was not found`);
    }

    const currentStatus = deriveStatus(existing.startTime, existing.endTime);
    if (currentStatus !== "live") {
      return fail(
        ERROR_CODES.CONFLICT,
        `Match ${matchId} is ${currentStatus}; scores can only change while live`
      );
    }

    const {
      homeScore,
      awayScore,
      homeWickets,
      awayWickets,
      homeInnings,
      awayInnings,
      homeOvers,
      awayOvers,
      result,
    } = parsedBody.data;

    if (homeScore < existing.homeScore || awayScore < existing.awayScore) {
      return fail(
        ERROR_CODES.CONFLICT,
        "Scores cannot decrease (received a value below the current score)"
      );
    }

    // Wickets are monotonic within an innings, but a new innings resets them to
    // zero — so only compare when the innings count is unchanged.
    const sameInnings =
      (homeInnings ?? existing.homeInnings) === existing.homeInnings &&
      (awayInnings ?? existing.awayInnings) === existing.awayInnings;

    if (
      sameInnings &&
      ((homeWickets !== undefined && homeWickets < existing.homeWickets) ||
        (awayWickets !== undefined && awayWickets < existing.awayWickets))
    ) {
      return fail(
        ERROR_CODES.CONFLICT,
        "Wickets cannot decrease within the same innings"
      );
    }

    const nextHomeWickets = homeWickets ?? existing.homeWickets;
    const nextAwayWickets = awayWickets ?? existing.awayWickets;
    const nextHomeOvers = homeOvers === undefined ? existing.homeOvers : homeOvers;
    const nextAwayOvers = awayOvers === undefined ? existing.awayOvers : awayOvers;

    const unchanged =
      homeScore === existing.homeScore &&
      awayScore === existing.awayScore &&
      nextHomeWickets === existing.homeWickets &&
      nextAwayWickets === existing.awayWickets &&
      (homeInnings ?? existing.homeInnings) === existing.homeInnings &&
      (awayInnings ?? existing.awayInnings) === existing.awayInnings &&
      nextHomeOvers === existing.homeOvers &&
      nextAwayOvers === existing.awayOvers &&
      (result == null || result === existing.result);

    if (unchanged) {
      // Idempotent no-op: return the current state without a redundant broadcast.
      return ok(serializeMatch({ ...existing, status: currentStatus as never }));
    }

    const updated = await prisma.match.update({
      where: { id: matchId },
      data: {
        homeScore,
        awayScore,
        homeWickets: nextHomeWickets,
        awayWickets: nextAwayWickets,
        ...(homeInnings !== undefined ? { homeInnings } : {}),
        ...(awayInnings !== undefined ? { awayInnings } : {}),
        homeOvers: nextHomeOvers,
        awayOvers: nextAwayOvers,
        ...(result != null ? { result } : {}),
        // Keep the stored status warm so raw SQL readers stay accurate too.
        status: currentStatus,
      },
    });

    const payload = {
      matchId,
      homeScore: updated.homeScore,
      awayScore: updated.awayScore,
      homeWickets: updated.homeWickets,
      awayWickets: updated.awayWickets,
      homeOvers: nextHomeOvers,
      awayOvers: nextAwayOvers,
    };

    try {
      emitScoreUpdate(payload);
    } catch (error) {
      console.error("[api] failed to broadcast match:score", error);
    }

    return ok(serializeMatch(updated));
  });
}

