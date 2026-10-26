import type { NextRequest } from "next/server";

import { ERROR_CODES, fail, guard, ok } from "@/lib/http";
import { findMatch } from "@/lib/queries";
import { idParamSchema, toIssues } from "@/lib/validations";

/**
 * GET /api/matches/[id]
 *
 * Single fixture lookup, including the derived status. Used when a client tunes
 * into a match directly (deep link / reconnect) instead of going through the
 * paginated dashboard list.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/matches/[id]">) {
  return guard(async () => {
    const parsedId = idParamSchema.safeParse((await ctx.params).id);
    if (!parsedId.success) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid match id", toIssues(parsedId.error));
    }

    const match = await findMatch(parsedId.data);
    if (!match) {
      return fail(ERROR_CODES.NOT_FOUND, `Match ${parsedId.data} was not found`);
    }

    return ok(match);
  });
}

