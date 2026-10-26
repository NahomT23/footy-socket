import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

/**
 * Vitest configuration.
 *
 * The default project runs Node-environment suites (pure logic, Prisma, Route
 * Handlers). Component suites opt into jsdom per file with a `@vitest-environment
 * jsdom` docblock, which keeps the fast majority of tests DOM-free.
 *
 * Playwright specs live in `tests/e2e` and are excluded here (`npm run test:e2e`).
 */
const testEnv = loadEnv("test", process.cwd(), "");

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the tsconfig `paths` alias for every suite.
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./tests/setup/global-setup.ts"],
    setupFiles: ["./tests/setup/node-setup.ts"],
    // Database-backed suites share one PostgreSQL schema, so they must not run
    // in parallel across files. Vitest 5 moved former `poolOptions` to the
    // top level: a single forked process for the whole run.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    env: {
      DATABASE_URL: testEnv.DATABASE_URL,
      NODE_ENV: "test",
      // Pin the rate limits so the flood tests are deterministic and never
      // inherit the chattier values a developer sets for the simulator.
      RATE_LIMIT_MATCH_CREATE: "60",
      RATE_LIMIT_SCORE: "240",
      RATE_LIMIT_COMMENTARY: "600",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "hooks/**", "components/**", "app/api/**"],
      exclude: ["**/*.d.ts", "lib/prisma.ts"],
      thresholds: {
        // Guards against silent coverage regressions in the core layers.
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 65,
      },
    },
  },
});
