import { expect, test } from "@playwright/test";

import {
  cardForTeam,
  connectionPill,
  fixtureCards,
  getLiveFootballMatch,
  getMatch,
  loadFixtures,
  scoreBox,
  waitForLiveConnection,
} from "./helpers";

/**
 * Dashboard rendering and navigation.
 *
 * These specs assert what a real browser paints from the server snapshot —
 * statuses, scores, localised kick-off times, filtering and pagination.
 */
test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/sportz/i);
  });

  test("renders the fixture grid from the server snapshot", async ({ page }) => {
    await expect(fixtureCards(page)).toHaveCount(4);
    for (const team of ["E2E Arsenal", "E2E Lakers", "E2E India", "E2E Liverpool"]) {
      // Scoped to the card: plain text matching would also hit the result line
      // ("E2E Liverpool win") and other composed labels.
      await expect(cardForTeam(page, team)).toHaveCount(1);
    }
  });

  test("shows the three-phase lifecycle statuses", async ({ page }) => {
    // Live: pulsing badge + a Watch live action.
    const liveCard = cardForTeam(page, "E2E Arsenal");
    await expect(liveCard.getByText(/^live$/i)).toBeVisible();
    await expect(liveCard.getByRole("button", { name: /watch live/i })).toBeVisible();

    // Scheduled: advertises its start time instead of an action.
    const scheduledCard = cardForTeam(page, "E2E India");
    await expect(scheduledCard.getByText(/scheduled/i)).toBeVisible();
    await expect(scheduledCard.getByRole("button", { name: /watch live/i })).toHaveCount(0);

    // Finished: locked, and reports the result.
    const finishedCard = cardForTeam(page, "E2E Liverpool");
    await expect(finishedCard.getByText(/finished/i)).toBeVisible();
    await expect(finishedCard.getByText(/E2E Liverpool win/i)).toBeVisible();
  });

  test("renders persisted scores in their labelled score boxes", async ({ page, request }) => {
    // Scores are asserted against the API rather than hardcoded: the realtime
    // specs deliberately change them, and the suite shares one database.
    const { liveFootballId, liveBasketballId } = await loadFixtures();

    for (const id of [liveFootballId, liveBasketballId]) {
      const match = await getMatch(request, id);
      await expect(scoreBox(page, match.homeTeam)).toHaveText(String(match.homeScore));
      await expect(scoreBox(page, match.awayTeam)).toHaveText(String(match.awayScore));
    }
  });

  test("renders cricket scores as runs/wickets, never bare runs", async ({ page, request }) => {
    const { scheduledId } = await loadFixtures();
    const cricket = await getMatch(request, scheduledId);

    // Cricket identifies the format through the score box itself.
    await expect(scoreBox(page, cricket.homeTeam)).toHaveText(`${cricket.homeScore}/${cricket.homeWickets}`);
    await expect(scoreBox(page, cricket.awayTeam)).toHaveText(`${cricket.awayScore}/${cricket.awayWickets}`);

    // Non-cricket sports must NOT gain a slash.
    const { liveFootballId } = await loadFixtures();
    const football = await getMatch(request, liveFootballId);
    await expect(scoreBox(page, football.homeTeam)).toHaveText(String(football.homeScore));
  });

  test("negotiates the realtime connection and reports it as Live", async ({ page }) => {
    await expect(connectionPill(page)).toBeVisible();
    await waitForLiveConnection(page);
    await expect(connectionPill(page)).toContainText(/live/i);
  });

  test("filters fixtures by sport and updates the counts", async ({ page }) => {
    await expect(fixtureCards(page)).toHaveCount(4);

    await page.getByRole("button", { name: /basketball/i }).click();

    await expect(fixtureCards(page)).toHaveCount(1);
    await expect(cardForTeam(page, "E2E Lakers")).toHaveCount(1);
    await expect(cardForTeam(page, "E2E Arsenal")).toHaveCount(0);
    await expect(cardForTeam(page, "E2E India")).toHaveCount(0);

    await page.getByRole("button", { name: /all sports/i }).click();
    await expect(fixtureCards(page)).toHaveCount(4);
  });

  test("shows the empty commentary state until a match is tuned in", async ({ page }) => {
    await expect(page.getByText(/no match selected/i)).toBeVisible();
  });

  test("re-sync rebuilds the grid without a page reload", async ({ page }) => {
    const navigationCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);

    await page.getByRole("button", { name: /re-sync/i }).click();

    await expect(fixtureCards(page)).toHaveCount(4);
    // Still the same document: the button refetched, it did not navigate.
    await expect
      .poll(async () => page.evaluate(() => performance.getEntriesByType("navigation").length))
      .toBe(navigationCount);
  });

  test("exposes accessible landmarks and skips to the grid", async ({ page }) => {
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: /matches/i }).or(page.locator("section[aria-label='Matches']"))).toBeVisible();
    await expect(page.getByRole("link", { name: /skip to matches/i })).toBeAttached();
  });

  test("pagination reports the visible range", async ({ page }) => {
    const pager = page.getByRole("navigation", { name: /pagination/i });
    // Four seeded fixtures fit on a single page.
    await expect(pager).toContainText(/showing 1–4 of 4/i);
    await expect(page.getByRole("button", { name: /prev/i })).toBeDisabled();
    await expect(fixtureCards(page)).toHaveCount(4);
  });

  test("a deep-linked live fixture can be fetched directly", async ({ page, request }) => {
    const match = await getLiveFootballMatch(request);
    const response = await request.get(`/api/matches/${match.id}`);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).data.homeTeam).toBe("E2E Arsenal");
    await expect(cardForTeam(page, "E2E Arsenal")).toHaveCount(1);
  });
});
