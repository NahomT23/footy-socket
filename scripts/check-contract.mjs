#!/usr/bin/env node
/**
 * Contract guard.
 *
 * `server.mjs` is plain Node ESM and therefore cannot import the TypeScript
 * contract in `lib/`. Instead of trusting two hand-maintained copies, this
 * script compares them and fails if they drift:
 *
 *   1. Socket event names    server.mjs  <->  lib/types.ts (SOCKET_EVENTS)
 *   2. Room naming           server.mjs  <->  lib/types.ts (matchRoom)
 *   3. Status derivation     server.mjs  <->  lib/match-status.ts (deriveStatus)
 *
 * Run it in CI before deploying:  npm run check:contract
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SOCKET_EVENTS, matchRoom } from "../lib/types.ts";
import { deriveStatus } from "../lib/match-status.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = await readFile(join(root, "server.mjs"), "utf8");

const failures = [];

function check(name, passed, detail = "") {
  const icon = passed ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m";
  console.log(`  ${icon} ${name}${detail ? ` \u001b[2m— ${detail}\u001b[0m` : ""}`);
  if (!passed) failures.push(name);
}

console.log("\nSportz contract check\n");

/* ------------------------------------------------------------------ */
/* 1 + 2. Socket events and room naming                                */
/* ------------------------------------------------------------------ */

console.log("  socket contract");

for (const [key, value] of Object.entries(SOCKET_EVENTS)) {
  const pattern = new RegExp(`${key}:\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  check(`server.mjs mirrors SOCKET_EVENTS.${key}`, pattern.test(serverSource), value);
}

check(
  "server.mjs builds room names as match:{id}",
  serverSource.includes("return `match:${matchId}`;"),
  matchRoom(42)
);

check(
  "server.mjs and lib agree on a room name",
  new RegExp(`return \`${matchRoom(42).replace("42", "\\$\\{matchId\\}")}\``).test(serverSource),
  matchRoom(42)
);

/* ------------------------------------------------------------------ */
/* 3. Status derivation                                                */
/* ------------------------------------------------------------------ */

console.log("\n  status derivation");

// Extract the mirrored implementation and exercise it against the real one.
const mirrored = serverSource.match(/function deriveStatus\([\s\S]*?\n\}/);
check("server.mjs defines deriveStatus", Boolean(mirrored), mirrored ? "found" : "missing");

if (mirrored) {
  const mirroredDerive = new Function(
    `"use strict"; ${mirrored[0]}; return deriveStatus;`
  )();

  const base = Date.parse("2026-01-01T12:00:00.000Z");
  const minute = 60_000;

  // `[label, startOffsetMin, endOffsetMin, nowOffsetMin, expected]`
  const cases = [
    ["before kickoff", 10, 70, 0, "scheduled"],
    ["exactly at kickoff", 0, 60, 0, "live"],
    ["mid fixture", -10, 50, 0, "live"],
    ["one ms before end", -10, 0.000_017, 0, "live"],
    ["exactly at end", -10, 0, 0, "finished"],
    ["long after end", -70, -10, 0, "finished"],
  ];

  for (const [label, startOffset, endOffset, nowOffset, expected] of cases) {
    const start = new Date(base + startOffset * minute);
    const end = new Date(base + endOffset * minute);
    const now = new Date(base + nowOffset * minute);

    const fromLib = deriveStatus(start, end, now);
    const fromServer = mirroredDerive(start, end, now);

    check(
      `both implementations agree (${label})`,
      fromLib === expected && fromServer === expected,
      `lib=${fromLib} server=${fromServer} expected=${expected}`
    );
  }
}

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`\n\u001b[31m✗ FAIL\u001b[0m ${failures.length} contract check(s) failed\n`);
  process.exit(1);
}

console.log("\n\u001b[32m✓ PASS\u001b[0m server.mjs and lib/ are in sync\n");
