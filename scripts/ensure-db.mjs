#!/usr/bin/env node
/**
 * `ensure-db` — start the workspace-local PostgreSQL cluster if it is down.
 *
 * Runs automatically before `npm run dev` (the `predev` hook), so a rebooted
 * machine no longer surfs into "Can't reach database server at 127.0.0.1:5433".
 *
 * It mirrors the options of the `db:start` script exactly (`PGDATA`, `PGPORT`,
 * socket dir /tmp), stays silent when the cluster is already accepting
 * connections, and exits non-zero with a hint when there is nothing to start.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dataDir = process.env.PGDATA ?? "./.pgdata";
const port = process.env.PGPORT ?? "5433";
const socketDir = "/tmp";
const logFile = path.join(dataDir, "server.log");

function isReady() {
  const probe = spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", port], {
    encoding: "utf8",
  });
  return probe.status === 0;
}

if (isReady()) {
  process.exit(0);
}

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.error(
    `No local PostgreSQL cluster at ${dataDir}.\n` +
      "Create one first (see .env.example):\n" +
      `  initdb -D ${dataDir} -U postgres --auth=trust\n` +
      "  npm run db:push"
  );
  process.exit(1);
}

console.log(`PostgreSQL not listening on ${port} — starting it...`);

try {
  execFileSync(
    "pg_ctl",
    [
      "-D", dataDir,
      "-o", `-p ${port} -k ${socketDir}`,
      "-l", logFile,
      "start",
    ],
    { stdio: "inherit" }
  );
} catch (error) {
  console.error(`pg_ctl failed: ${error.message}`);
  console.error(`Check ${logFile} for details.`);
  process.exit(1);
}

const deadline = Date.now() + 15_000;
while (!isReady()) {
  if (Date.now() > deadline) {
    console.error("PostgreSQL did not accept connections within 15s.");
    console.error(`Check ${logFile} for details.`);
    process.exit(1);
  }
  await sleep(250);
}

console.log("PostgreSQL is ready.");
