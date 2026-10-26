import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { clientKey, ERROR_CODES, fail, guard, ok, rateLimit, readJson } from "@/lib/http";

/**
 * The shared HTTP envelope and abuse shield. Every Route Handler depends on
 * these, so their contract is pinned here.
 */

function jsonRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("ok", () => {
  it("wraps the payload in a { data } envelope with status 200", async () => {
    const response = ok({ id: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 1 } });
  });

  it("accepts an explicit status", () => {
    expect(ok({ id: 1 }, 201).status).toBe(201);
  });

  it("handles arrays and null", async () => {
    expect(await ok([]).json()).toEqual({ data: [] });
    expect(await ok(null).json()).toEqual({ data: null });
  });
});

describe("fail", () => {
  it.each([
    [ERROR_CODES.VALIDATION_ERROR, 400],
    [ERROR_CODES.NOT_FOUND, 404],
    [ERROR_CODES.CONFLICT, 409],
    [ERROR_CODES.RATE_LIMITED, 429],
    [ERROR_CODES.INTERNAL_ERROR, 500],
  ])("maps %s to HTTP %i", async (code, status) => {
    const response = fail(code, "boom");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "boom" } });
  });

  it("includes field issues when provided", async () => {
    const response = fail(ERROR_CODES.VALIDATION_ERROR, "bad", [{ path: "sport", message: "Required" }]);
    const body = await response.json();
    expect(body.error.issues).toEqual([{ path: "sport", message: "Required" }]);
  });
});

describe("readJson", () => {
  it("parses a JSON body", async () => {
    const result = await readJson(jsonRequest(JSON.stringify({ a: 1 })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("rejects a non-JSON content type without parsing", async () => {
    const result = await readJson(jsonRequest("a=1", "application/x-www-form-urlencoded"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.message).toMatch(/application\/json/);
    }
  });

  it("rejects malformed JSON", async () => {
    const result = await readJson(jsonRequest("{oops"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect((await result.response.json()).error.message).toMatch(/not valid JSON/);
  });
});

describe("guard", () => {
  it("passes through a successful response", async () => {
    expect((await guard(async () => ok({ fine: true }))).status).toBe(200);
  });

  it("converts a ZodError into a 400 with issues", async () => {
    const schema = z.object({ name: z.string() });
    const response = await guard(async () => {
      schema.parse({});
      return ok({});
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.issues[0].path).toBe("name");
  });

  it("converts an unexpected throw into a 500 envelope", async () => {
    const response = await guard(async () => {
      throw new Error("database exploded");
    });
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it("never leaks the internal error message", async () => {
    const response = await guard(async () => {
      throw new Error("secret connection string");
    });
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("clientKey", () => {
  it("prefers the first x-forwarded-for hop", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKey(request, "scope")).toBe("scope:203.0.113.7");
  });

  it("falls back to a local key when the header is absent", () => {
    expect(clientKey(new Request("http://localhost"), "scope")).toBe("scope:local");
  });

  it("scopes keys so different endpoints do not share a budget", () => {
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientKey(request, "a")).not.toBe(clientKey(request, "b"));
  });
});

describe("rateLimit", () => {
  it("allows exactly `limit` requests inside the window", () => {
    const key = `unit:${Math.random()}`;
    for (let index = 0; index < 3; index += 1) {
      expect(rateLimit(key, { limit: 3, windowMs: 60_000 })).toEqual({ allowed: true });
    }
    const blocked = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps separate budgets per key", () => {
    const a = `unit:${Math.random()}`;
    const b = `unit:${Math.random()}`;
    rateLimit(a, { limit: 1, windowMs: 60_000 });
    expect(rateLimit(a, { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    expect(rateLimit(b, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("refills once the window elapses", async () => {
    const key = `unit:${Math.random()}`;
    rateLimit(key, { limit: 1, windowMs: 40 });
    expect(rateLimit(key, { limit: 1, windowMs: 40 }).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rateLimit(key, { limit: 1, windowMs: 40 }).allowed).toBe(true);
  });

  it("reports a retry delay that does not exceed the window", () => {
    const key = `unit:${Math.random()}`;
    rateLimit(key, { limit: 1, windowMs: 5_000 });
    const blocked = rateLimit(key, { limit: 1, windowMs: 5_000 });
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(5_000);
    }
  });
});

describe("NextResponse integration", () => {
  it("returns real NextResponse instances", () => {
    expect(ok({})).toBeInstanceOf(NextResponse);
    expect(fail(ERROR_CODES.NOT_FOUND, "x")).toBeInstanceOf(NextResponse);
  });
});
