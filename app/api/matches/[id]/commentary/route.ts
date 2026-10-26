import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { env } from "@/lib/env";
import { ERROR_CODES, clientKey, fail, guard, ok, rateLimit, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeCommentary } from "@/lib/serializers";
import { emitCommentary } from "@/lib/socket-server";
import { listCommentary } from "@/lib/queries";
import {
  createCommentarySchema,
  idParamSchema,
  limitQuerySchema,
  toIssues,
} from "@/lib/validations";

/**
 * GET /api/matches/[id]/commentary
 *
 * Newest-first play-by-play for one fixture, capped by `?limit=` (default 50,
 * max 100). Ordered by `sequence` first so a slow network write can never
 * scramble the timeline, then by creation time.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/matches/[id]/commentary">
) {
  return guard(async () => {
    const parsedId = idParamSchema.safeParse((await ctx.params).id);
    if (!parsedId.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid match id", toIssues(parsedId.error));
    }

    const parsedLimit = limitQuerySchema.safeParse(
      request.nextUrl.searchParams.get("limit") ?? undefined
    );
    if (!parsedLimit.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid limit query parameter", toIssues(parsedLimit.error));
    }

    const match = await prisma.match.findUnique({
      where: { id: parsedId.data },
      select: { id: true },
    });
    if (!match) {
      return fail(ERROR_CODES.NOT_FOUND, `Match ${parsedId.data} was not found`);
    }

    return ok(await listCommentary(parsedId.data, parsedLimit.data));
  });
}

/**
 * POST /api/matches/[id]/commentary
 *
 * Appends one play-by-play entry and pushes it to the fixture room. `sequence`
 * is unique per match, so a duplicated replay is reported as CONFLICT instead
 * of silently doubling the feed.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/matches/[id]/commentary">
) {
  return guard(async () => {
    const parsedId = idParamSchema.safeParse((await ctx.params).id);
    if (!parsedId.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid match id", toIssues(parsedId.error));
    }

    const limited = rateLimit(clientKey(request, "commentary:create"), {
      limit: env.RATE_LIMIT_COMMENTARY,
      windowMs: 60_000,
    });
    if (!limited.allowed) {
      return fail(
        ERROR_CODES.RATE_LIMITED,
        `Too many commentary writes. Retry in ${Math.ceil(limited.retryAfterMs / 1000)}s.`
      );
    }

    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsedBody = createCommentarySchema.safeParse(body.value);
    if (!parsedBody.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid commentary payload", toIssues(parsedBody.error));
    }

    const matchId = parsedId.data;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (!match) {
      return fail(ERROR_CODES.NOT_FOUND, `Match ${matchId} was not found`);
    }

    const { minute, sequence, period, eventType, actor, team, message, metadata, tags } =
      parsedBody.data;

    try {
      const created = await prisma.commentary.create({
        data: {
          matchId,
          minute: minute ?? null,
          sequence: sequence ?? null,
          period: period ?? null,
          eventType: eventType ?? null,
          actor: actor ?? null,
          team: team ?? null,
          message,
          metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          tags,
        },
      });

      const commentary = serializeCommentary(created);

      try {
        emitCommentary(commentary);
      } catch (error) {
        console.error("[api] failed to broadcast match:commentary", error);
      }

      return ok(commentary, 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return fail(
          ERROR_CODES.CONFLICT,
          `Commentary sequence ${sequence} already exists for match ${matchId}`
        );
      }
      throw error;
    }
  });
}

