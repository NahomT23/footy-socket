/**
 * HTTP helpers shared by every Route Handler.
 *
 * One response envelope (`{ data }` / `{ error }`) plus one place to translate
 * thrown errors into status codes, so clients never have to guess.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { toIssues } from "./validations";
import type { ApiFailure } from "./types";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function fail(
  code: ErrorCode,
  message: string,
  issues?: ApiFailure["error"]["issues"]
): NextResponse {
  const body: ApiFailure = { error: { code, message, ...(issues ? { issues } : {}) } };
  return NextResponse.json(body, { status: STATUS_BY_CODE[code] });
}

/**
 * Reads and JSON-parses a request body, returning a discriminated result so a
 * malformed body becomes a 400 instead of an unhandled exception.
 */
export async function readJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: fail(ERROR_CODES.VALIDATION_ERROR, "Content-Type must be application/json"),
    };
  }

  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: fail(ERROR_CODES.VALIDATION_ERROR, "Request body is not valid JSON") };
  }
}

/** Wraps a handler so unexpected failures return a consistent 500 envelope. */
export async function guard(
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ZodError) {
      return fail(ERROR_CODES.VALIDATION_ERROR, "Request validation failed", toIssues(error));
    }
    console.error("[api] unhandled error:", error);
    return fail(ERROR_CODES.INTERNAL_ERROR, "Unexpected server error");
  }
}

/* ------------------------------------------------------------------ */
/* HTTP rate limiting (abuse shield for write endpoints)               */
/* ------------------------------------------------------------------ */

interface Bucket {
  tokens: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter for mutating endpoints (match creation, score updates,
 * commentary writes). In-memory on purpose: a single custom server owns the
 * whole surface, so there is no cross-instance state to coordinate.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { tokens: limit - 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.tokens <= 0) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.tokens -= 1;
  return { allowed: true };
}

/** Best-effort client identity for rate-limit keys (proxy header first). */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${scope}:${ip}`;
}

/** Periodically drops expired buckets so the map cannot grow forever. */
if (!(globalThis as { __sportzBucketReaper?: boolean }).__sportzBucketReaper) {
  (globalThis as { __sportzBucketReaper?: boolean }).__sportzBucketReaper = true;
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, 60_000);
  reaper.unref?.();
}
