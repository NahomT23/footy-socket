/**
 * Shared helpers for the simulation engine.
 *
 * Plain Node ESM: `scripts/*` deliberately avoids the TypeScript toolchain so
 * the simulator can run against a production build with no extra setup.
 */

export const DEFAULT_BASE_URL = process.env.SPORTZ_URL ?? "http://127.0.0.1:3000";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Calls the Sportz REST API and unwraps the `{ data }` envelope.
 * Never retries: the simulator is a client like any other, and a failed write
 * should surface immediately rather than silently reorder the timeline.
 */
export async function apiFetch(baseUrl, path, { method = "GET", body } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed?.error?.message ?? `HTTP ${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, parsed?.error?.code);
  }

  return parsed?.data ?? null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic-ish jitter so a cluster of events does not look metronomic. */
export function jitter(baseMs, spreadMs) {
  return baseMs + Math.floor(Math.random() * spreadMs);
}

/** `2026-10-16T21:00:00.000Z` -> `21:00:00` for compact log lines. */
export function clock(date = new Date()) {
  return date.toISOString().slice(11, 19);
}

export function log(scope, message) {
  console.log(`${clock()}  ${scope.padEnd(10)} ${message}`);
}

/* ------------------------------------------------------------------ */
/* Terminal styling (no dependencies)                                  */
/* ------------------------------------------------------------------ */

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export const paint = Object.fromEntries(
  Object.entries(CODES).map(([name, code]) => [
    name,
    (text) => (useColor ? `${code}${text}${CODES.reset}` : String(text)),
  ])
);

/** Parses `--flag`, `--key value` and `--key=value` style arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
    } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      flags[key] = argv[index + 1];
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
}
