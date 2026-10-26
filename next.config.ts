import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,

  /**
   * The dev server refuses cross-origin requests for its own assets by default.
   * Without this, opening the app on `http://127.0.0.1:3000` (as the headless
   * browser and the E2E suite do) blocks `/_next/*` — including the bundled
   * socket.io client — so the realtime connection silently never starts.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", "[::1]"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
