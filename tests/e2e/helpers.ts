/**
 * Shared helpers for the Playwright suite.
 *
 * Fixture ids are produced by `global-setup.ts` and read from a hand-off file,
 * because global setup runs in a different process from the specs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const FIXTURES_PATH = join(process.cwd(), ".cache", "e2e-fixtures.json");

export interface E2EFixtures {
  liveFootballId: number;
  liveBasketballId: number;
  scheduledId: number;
  finishedId: number;
}

export async function loadFixtures(): Promise<E2EFixtures> {
  return JSON.parse(await readFile(FIXTURES_PATH, "utf8"));
}

interface Match {
  id: number;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  status: "scheduled" | "live" | "finished";
  homeScore: number;
  awayScore: number;
  /** Cricket detail, present on every match (0 for other sports). */
  homeWickets: number;
  awayWickets: number;
  homeInnings: number;
  awayInnings: number;
  homeOvers: string | null;
  awayOvers: string | null;
  result: string | null;
  startTime: string;
  endTime: string;
}

interface Commentary {
  id: number;
  matchId: number;
  sequence: number | null;
  message: string;
}

/** Unwraps the `{ data }` envelope used by every endpoint. */
export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), `GET ${path} -> ${response.status()}`).toBeTruthy();
  return (await response.json()).data as T;
}

export async function getMatch(request: APIRequestContext, id: number): Promise<Match> {
  return apiGet<Match>(request, `/api/matches/${id}`);
}

export async function getLiveFootballMatch(request: APIRequestContext): Promise<Match> {
  const { liveFootballId } = await loadFixtures();
  return getMatch(request, liveFootballId);
}

/** Highest scripted sequence for a fixture, so probes never collide. */
export async function nextSequence(request: APIRequestContext, matchId: number): Promise<number> {
  const rows = await apiGet<Commentary[]>(request, `/api/matches/${matchId}/commentary?limit=1`);
  return rows.reduce((max, row) => Math.max(max, row.sequence ?? 0), 0) + 1;
}

/**
 * Publishes a commentary entry through the public API. Everything the browser
 * renders must arrive over the socket, so the test never touches the DOM to
 * inject state.
 */
export async function publishCommentary(
  request: APIRequestContext,
  matchId: number,
  message: string,
  overrides: Partial<{ eventType: string; actor: string; team: string }> = {}
): Promise<Commentary> {
  const response = await request.post(`/api/matches/${matchId}/commentary`, {
    data: {
      minute: 90,
      sequence: await nextSequence(request, matchId),
      period: "E2E",
      eventType: overrides.eventType ?? "goal",
      actor: overrides.actor ?? "E2E Bot",
      team: overrides.team ?? "E2E Arsenal",
      message,
      metadata: { e2e: true },
      tags: ["e2e"],
    },
  });
  expect(response.status(), `commentary write -> ${response.status()}`).toBe(201);
  return (await response.json()).data as Commentary;
}

/** Pushes a score change through the public API. */
export async function publishScore(
  request: APIRequestContext,
  matchId: number,
  homeScore: number,
  awayScore: number
): Promise<void> {
  const response = await request.patch(`/api/matches/${matchId}/score`, {
    data: { homeScore, awayScore },
  });
  expect(response.ok(), `score write -> ${response.status()}`).toBeTruthy();
}

/**
 * The card for a named team. Cards are matched on their visible text, which is
 * how a user identifies them, and keeps specs independent of grid ordering.
 */
export function cardForTeam(page: Page, team: string) {
  return page.locator("article").filter({ hasText: team });
}

/**
 * Tunes into a specific fixture.
 *
 * Selecting by team (not by index) matters: the dashboard shows several live
 * fixtures at once, so `getByRole(...).first()` would silently subscribe to
 * whichever card happens to render first.
 */
export async function watchMatch(
  page: Page,
  team = "E2E Arsenal"
): Promise<void> {
  const card = cardForTeam(page, team);
  await expect(card, `a card for "${team}" must be rendered`).toBeVisible();

  const button = card.getByRole("button", { name: /watch live/i });
  await expect(button, `"${team}" must be live to be watchable`).toBeVisible();
  await button.click();

  await expect(page.locator('aside[aria-label^="Live commentary"]')).toBeVisible();
}

/** All fixture cards currently rendered. */
export function fixtureCards(page: Page) {
  return page.locator("article");
}

/**
 * A team's score box.
 *
 * The accessible label carries the value (`"E2E Arsenal score: 3"`), so this
 * matches the prefix; the `data-side` attribute keeps the selector structural
 * rather than purely textual.
 */
export function scoreBox(page: Page, team: string) {
  return page.locator(`[data-side][aria-label^="${team} score"]`);
}

/** The connection pill in the header (`data-testid` is set by the component). */
export function connectionPill(page: Page) {
  return page.getByTestId("connection-status");
}

/** The feed's own report of which room it is subscribed to. */
export function feedRoom(page: Page) {
  return page.getByTestId("feed-room");
}

/** The feed's subscriber count, as confirmed by the server acknowledgement. */
export function feedSubscribers(page: Page) {
  return page.getByTestId("feed-subscribers");
}

/** Number of events currently rendered in the tuned feed. */
export function feedEventCount(page: Page) {
  return page.getByTestId("feed-event-count");
}

/** Waits until the Socket.IO client reports a live connection. */
export async function waitForLiveConnection(page: Page): Promise<void> {
  await expect(connectionPill(page)).toHaveAttribute("data-status", "connected", { timeout: 30_000 });
}
