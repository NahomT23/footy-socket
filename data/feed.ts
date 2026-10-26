/**
 * Generated, typed view of the expanded commentary feed.
 *
 * `scripts/build-fixtures.ts` writes `data/feed.json`; this module is the typed
 * entry point the simulator imports, so the simulator never parses JSON at
 * runtime and the shape is checked at build time.
 *
 * Regenerate with: npm run fixtures:build
 */
import feed from "./feed.json" with { type: "json" };
import type { ScriptedEvent } from "./fixtures";

export interface FeedFixture {
  sport: "football" | "cricket" | "basketball";
  homeTeam: string;
  awayTeam: string;
  competition: string;
  venue: string;
  events: ScriptedEvent[];
}

export const FEED = feed as FeedFixture[];
