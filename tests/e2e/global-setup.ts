/**
 * Playwright global setup.
 *
 * Prepares the dedicated E2E database before the browser suite runs:
 * schema sync + a deterministic fixture set so assertions never depend on
 * whatever the simulation engine happened to leave behind.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

import { E2E_DATABASE_URL } from "../../playwright.config";

const run = promisify(execFile);

/**
 * Shared hand-off file between global setup and the spec workers.
 *
 * Paths are resolved from the process working directory (the repository root,
 * where Playwright is invoked) rather than `import.meta.url`, because this file
 * is transpiled to CommonJS and `import.meta` is unavailable there.
 */
export const FIXTURES_PATH = join(process.cwd(), ".cache", "e2e-fixtures.json");

export default async function globalSetup() {
  if (!E2E_DATABASE_URL) {
    throw new Error("No E2E database URL. Set DATABASE_URL in .env.test (see the file header).");
  }

  const url = new URL(E2E_DATABASE_URL);
  const database = url.pathname.replace(/^\//, "");

  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run E2E tests against "${database}" — the name must end in "_test".`);
  }

  // Ensure the database exists, then sync the schema.
  const { stdout } = await run("psql", [
    "-h", url.hostname, "-p", url.port || "5432", "-U", url.username || "postgres",
    "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${database}'`,
  ]).catch((error) => {
    throw new Error(`PostgreSQL is unreachable — run \`npm run db:start\`.\n${error.message}`);
  });

  if (stdout.trim() !== "1") {
    await run("createdb", [
      "-h", url.hostname, "-p", url.port || "5432", "-U", url.username || "postgres", database,
    ]);
  }

  await run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });

  // Deterministic fixtures: two live, one scheduled, one finished (per E2E run).
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
  const now = Date.now();

  await prisma.commentary.deleteMany();
  await prisma.match.deleteMany();

  const [liveFootball, liveBasketball, scheduled, finished] = await Promise.all([
    prisma.match.create({
      data: {
        sport: "football",
        homeTeam: "E2E Arsenal",
        awayTeam: "E2E Chelsea",
        status: "live",
        startTime: new Date(now - 30 * 60_000),
        endTime: new Date(now + 60 * 60_000),
        homeScore: 1,
        awayScore: 0,
        // Oldest, so the dashboard's newest-first list puts it on page 1.
        createdAt: new Date(now - 4_000),
      },
    }),
    prisma.match.create({
      data: {
        sport: "basketball",
        homeTeam: "E2E Lakers",
        awayTeam: "E2E Celtics",
        status: "live",
        startTime: new Date(now - 10 * 60_000),
        endTime: new Date(now + 90 * 60_000),
        homeScore: 88,
        awayScore: 84,
        createdAt: new Date(now - 3_000),
      },
    }),
    prisma.match.create({
      data: {
        sport: "cricket",
        homeTeam: "E2E India",
        awayTeam: "E2E Australia",
        status: "scheduled",
        startTime: new Date(now + 45 * 60_000),
        endTime: new Date(now + 6 * 60 * 60_000),
        homeScore: 0,
        awayScore: 0,
        createdAt: new Date(now - 2_000),
      },
    }),
    prisma.match.create({
      data: {
        sport: "football",
        homeTeam: "E2E Liverpool",
        awayTeam: "E2E City",
        status: "finished",
        startTime: new Date(now - 5 * 60 * 60_000),
        endTime: new Date(now - 3 * 60 * 60_000),
        homeScore: 3,
        awayScore: 1,
        createdAt: new Date(now - 1_000),
      },
    }),
  ]);

  await prisma.commentary.createMany({
    data: [
      {
        matchId: liveFootball.id,
        minute: 12,
        sequence: 1,
        period: "First Half",
        eventType: "goal",
        actor: "E2E Saka",
        team: "E2E Arsenal",
        message: "GOAL! E2E Saka opens the scoring.",
        metadata: { xg: 0.21 },
        tags: ["goal"],
        createdAt: new Date(now - 20 * 60_000),
      },
      {
        matchId: liveFootball.id,
        minute: 24,
        sequence: 2,
        period: "First Half",
        eventType: "card",
        actor: "E2E James",
        team: "E2E Chelsea",
        message: "Yellow card for E2E James.",
        tags: ["yellow"],
        createdAt: new Date(now - 10 * 60_000),
      },
    ],
  });

  // Persist the ids for the worker processes (global setup runs in its own
  // process, so environment variables would not reach the specs).
  await writeFile(
    FIXTURES_PATH,
    JSON.stringify(
      {
        liveFootballId: liveFootball.id,
        liveBasketballId: liveBasketball.id,
        scheduledId: scheduled.id,
        finishedId: finished.id,
      },
      null,
      2
    ),
    "utf8"
  );

  await prisma.$disconnect();
  console.log(`  ✓ seeded E2E fixtures (live #${liveFootball.id}, basketball #${liveBasketball.id})`);
}
