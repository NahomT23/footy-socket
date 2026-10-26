import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

/**
 * Playwright configuration for the browser-level end-to-end suite.
 *
 * The suite boots the *real* custom server (`server.mjs`) against a dedicated
 * `sportz_test` PostgreSQL database, so Socket.IO, the Route Handlers, Prisma
 * and the React client are all exercised together on one port — exactly the
 * deployment shape.
 *
 * Install the browser once:  npx playwright install chromium
 */
const testEnv = loadEnv("test", process.cwd(), "");
const port = Number(testEnv.E2E_PORT ?? 3000);
// Always derived from `port` so the launched server and the readiness probe can
// never disagree (an explicit E2E_BASE_URL pointing elsewhere would silently
// make Playwright poll the wrong port until it times out).
const baseURL = `http://127.0.0.1:${port}`;

export const E2E_DATABASE_URL =
  testEnv.E2E_DATABASE_URL ?? testEnv.DATABASE_URL;

/**
 * Prefer an already-installed browser over a downloaded Playwright build.
 *
 * `channel: "chrome"` uses the system Google Chrome, which means the suite runs
 * without `npx playwright install` (useful in locked-down environments). Set
 * E2E_BROWSER_CHANNEL="" to fall back to the bundled chromium — in that case
 * run `npm run test:e2e:install` once.
 */
const browserChannel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },

  outputDir: "./.cache/playwright-results",

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {}),
        launchOptions: {
          args: [
            // Required in sandboxed/CI containers where the setuid sandbox is
            // unavailable.
            "--no-sandbox",
            "--hide-scrollbars",
          ],
        },
      },
    },
  ],

  globalSetup: "./tests/e2e/global-setup.ts",

  webServer: {
    // The unified server: Next.js + Socket.IO on a single port.
    command: "node server.mjs",
    // The custom server answers /healthz before Next.js is involved, so this is
    // a true readiness signal rather than "the port is open".
    url: `${baseURL}/healthz`,
    // Never reuse: `next dev` locks the project directory to one instance, and
    // reusing an already-running server would silently point the suite at the
    // *development* database instead of the isolated `sportz_test` one. If a dev
    // server is running it is replaced for the duration of the run.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATABASE_URL: E2E_DATABASE_URL ?? "",
    },
  },
});
