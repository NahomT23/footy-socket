/**
 * Vitest global setup: prepare an isolated test database.
 *
 * Runs once before the whole suite:
 *   1. Ensure `sportz_test` exists (createdb if missing).
 *   2. Push the Prisma schema so the database matches `prisma/schema.prisma`.
 *   3. Hand the URL to the workers through `provide`.
 *
 * The suite deliberately exercises a real PostgreSQL database rather than a
 * mocked Prisma client: the status-healing, unique constraints and ordering
 * behaviour that matter here only exist in SQL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadEnv } from "vite";

const run = promisify(execFile);

export default async function globalSetup() {
  const env = loadEnv("test", process.cwd(), "");
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from .env.test — see the file header for setup steps.");
  }

  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "");

  if (!database.endsWith("_test")) {
    // A guardrail: truncating a non-test database would be catastrophic.
    throw new Error(
      `Refusing to run tests against "${database}": the database name must end in "_test".`
    );
  }

  // 1. Create the database if it does not exist yet.
  try {
    await run("psql", [
      "-h", url.hostname,
      "-p", url.port || "5432",
      "-U", url.username || "postgres",
      "-d", "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${database}'`,
    ]).then(async ({ stdout }) => {
      if (stdout.trim() === "1") return;
      await run("createdb", [
        "-h", url.hostname,
        "-p", url.port || "5432",
        "-U", url.username || "postgres",
        database,
      ]);
      console.log(`  ✓ created test database "${database}"`);
    });
  } catch (error) {
    throw new Error(
      `Could not reach PostgreSQL at ${url.hostname}:${url.port || 5432}.\n` +
        `Start it with \`npm run db:start\`.\n\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 2. Sync the schema.
  await run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  console.log(`  ✓ test database ready (${database})`);
}
