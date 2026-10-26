import { expect, test, type Page } from "@playwright/test";

import {
  cardForTeam,
  feedEventCount,
  feedRoom,
  feedSubscribers,
  getMatch,
  loadFixtures,
  publishCommentary,
  publishScore,
  scoreBox,
  waitForLiveConnection,
  watchMatch,
} from "./helpers";

/**
 * Realtime behaviour in a real browser.
 *
 * Every assertion here is about state arriving over Socket.IO rooms: the test
 * mutates data through the public REST API and then waits for the *DOM* to
 * change, proving the broadcast reached the right client.
 *
 * Navigation counts are asserted alongside the DOM changes, because "the score
 * updated" would be meaningless if the page had simply reloaded.
 */

/** Unique marker so a previous run can never produce a false pass. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/**
 * Reads the fixture id the feed is subscribed to.
 *
 * Read from a `data-match-id` attribute rather than by parsing the rendered
 * label: adjacent inline spans are concatenated without a separator in the DOM,
 * so text scraping is inherently ambiguous ("room match:1080" + "1 subscriber"
 * reads as "10801").
 */
async function tunedMatchId(page: Page): Promise<number> {
  const room = feedRoom(page);
  await expect(room).toBeVisible();

  const id = Number(await room.getAttribute("data-match-id"));
  expect(Number.isInteger(id), `could not read the room id (got "${id}")`).toBe(true);
  return id;
}

async function navigationCount(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

test.describe("realtime commentary and scores", () => {
  test("tuning in subscribes to the fixture room and loads its history", async ({ page, request }) => {
    const { liveFootballId } = await loadFixtures();

    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    expect(await tunedMatchId(page)).toBe(liveFootballId);

    // The API's persisted history is what the feed renders first.
    const persisted = (await (await request.get(`/api/matches/${liveFootballId}/commentary`)).json()).data;
    await expect(feedEventCount(page)).toHaveAttribute("data-events", String(persisted.length));
    await expect(page.getByText("GOAL! E2E Saka opens the scoring.")).toBeVisible();

    // The server acknowledged the subscription with the room size.
    await expect(feedSubscribers(page)).toHaveAttribute("data-subscribers", "1");
  });

  test("a score broadcast updates the on-screen number without a page reload", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    const matchId = await tunedMatchId(page);
    const before = await getMatch(request, matchId);
    const navigationsBefore = await navigationCount(page);

    await publishScore(request, matchId, before.homeScore + 1, before.awayScore);

    await expect(scoreBox(page, before.homeTeam)).toHaveText(String(before.homeScore + 1), {
      timeout: 15_000,
    });
    await expect(scoreBox(page, before.awayTeam)).toHaveText(String(before.awayScore));

    // Still the same document: the update arrived over the socket.
    expect(await navigationCount(page)).toBe(navigationsBefore);
  });

  test("the changed score box flashes while the other stays still", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    const matchId = await tunedMatchId(page);
    const before = await getMatch(request, matchId);

    await publishScore(request, matchId, before.homeScore + 1, before.awayScore);

    // The pulse is a short animation; assert it was applied at least once.
    await expect(scoreBox(page, before.homeTeam)).toHaveAttribute("data-flashing", "true", {
      timeout: 10_000,
    });
    await expect(scoreBox(page, before.awayTeam)).not.toHaveAttribute("data-flashing", "true");

    // ...and that it clears itself afterwards.
    await expect(scoreBox(page, before.homeTeam)).not.toHaveAttribute("data-flashing", "true", {
      timeout: 10_000,
    });
  });

  test("commentary is pushed into the timeline without a page reload", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    const matchId = await tunedMatchId(page);
    const message = unique("E2E live commentary");
    const navigationsBefore = await navigationCount(page);

    await publishCommentary(request, matchId, message, { eventType: "wicket", actor: "E2E Wicket Bot" });

    await expect(page.getByText(message)).toBeVisible({ timeout: 15_000 });
    // Badges and actors are rendered from the structured payload.
    await expect(page.getByText("WICKET").first()).toBeVisible();
    await expect(page.getByText("E2E Wicket Bot").first()).toBeVisible();

    expect(await navigationCount(page)).toBe(navigationsBefore);
  });

  test("switching fixtures moves the subscription to the new room", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);

    await watchMatch(page, "E2E Arsenal");
    const footballId = await tunedMatchId(page);

    await watchMatch(page, "E2E Lakers");
    const basketballId = await tunedMatchId(page);

    // Two distinct rooms, and exactly one card is marked as being watched.
    expect(basketballId).not.toBe(footballId);
    await expect(page.getByRole("button", { name: /stop watching/i })).toHaveCount(1);
    await expect(
      cardForTeam(page, "E2E Lakers").getByRole("button", { name: /stop watching/i })
    ).toBeVisible();

    // Events for the abandoned room must no longer arrive.
    const stale = unique("E2E stale room");
    await publishCommentary(request, footballId, stale);
    await page.waitForTimeout(2_000);
    await expect(page.getByText(stale)).toHaveCount(0);

    // ...while the active room still receives them.
    const fresh = unique("E2E active room");
    await publishCommentary(request, basketballId, fresh);
    await expect(page.getByText(fresh)).toBeVisible({ timeout: 15_000 });
  });

  test("unsubscribing detaches the room and stops delivery", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    const matchId = await tunedMatchId(page);
    const before = unique("E2E before unsubscribe");
    await publishCommentary(request, matchId, before);
    await expect(page.getByText(before)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /unsubscribe/i }).click();
    await expect(page.getByText(/no match selected/i)).toBeVisible({ timeout: 15_000 });

    const after = unique("E2E after unsubscribe");
    await publishCommentary(request, matchId, after);

    // Give the socket a moment; the event must never appear.
    await page.waitForTimeout(2_500);
    await expect(page.getByText(after)).toHaveCount(0);
  });
});

test.describe("room isolation", () => {
  test("clients only receive events for the fixture they subscribed to", async ({ browser, request }) => {
    const { liveFootballId, liveBasketballId } = await loadFixtures();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto("/");
      await waitForLiveConnection(pageA);
      await watchMatch(pageA, "E2E Arsenal");
      expect(await tunedMatchId(pageA)).toBe(liveFootballId);

      await pageB.goto("/");
      await waitForLiveConnection(pageB);
      await watchMatch(pageB, "E2E Lakers");
      expect(await tunedMatchId(pageB)).toBe(liveBasketballId);

      // A football-only event must reach A and never B.
      const footballMessage = unique("E2E football only");
      await publishCommentary(request, liveFootballId, footballMessage);
      await expect(pageA.getByText(footballMessage)).toBeVisible({ timeout: 15_000 });

      await pageB.waitForTimeout(2_000);
      await expect(pageB.getByText(footballMessage)).toHaveCount(0);

      // A basketball-only event must reach B and never A.
      const basketballMessage = unique("E2E basketball only");
      await publishCommentary(request, liveBasketballId, basketballMessage);
      await expect(pageB.getByText(basketballMessage)).toBeVisible({ timeout: 15_000 });

      await pageA.waitForTimeout(2_000);
      await expect(pageA.getByText(basketballMessage)).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

test.describe("connection resilience", () => {
  test("a dropped transport reconnects and reconciles state from REST", async ({ page, request }) => {
    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    const matchId = await tunedMatchId(page);
    const pill = page.getByTestId("connection-status");

    // Force a genuine disconnect through the client's own socket instance.
    await page.evaluate(() => {
      (window as unknown as { __sportz: { disconnect: () => void } }).__sportz.disconnect();
    });
    await expect(pill).not.toHaveAttribute("data-status", "connected", { timeout: 15_000 });

    // Change the score while this client is offline: it misses the broadcast, so
    // only the reconnect + REST re-sync can reveal the new value.
    const current = await getMatch(request, matchId);
    await publishScore(request, matchId, current.homeScore + 1, current.awayScore);

    await page.evaluate(() => {
      (window as unknown as { __sportz: { connect: () => void } }).__sportz.connect();
    });

    await expect(pill).toHaveAttribute("data-status", "connected", { timeout: 30_000 });
    await expect(scoreBox(page, current.homeTeam)).toHaveText(String(current.homeScore + 1), {
      timeout: 20_000,
    });

    // Live delivery works again after the reconnect.
    const message = unique("E2E after reconnect");
    await publishCommentary(request, matchId, message);
    await expect(page.getByText(message)).toBeVisible({ timeout: 20_000 });
  });

  test("a cold reload reconciles the snapshot and resets the feed", async ({ page, request }) => {
    const { liveFootballId } = await loadFixtures();
    const before = await getMatch(request, liveFootballId);

    await page.goto("/");
    await waitForLiveConnection(page);
    await watchMatch(page, "E2E Arsenal");

    await page.reload();
    await waitForLiveConnection(page);

    await expect(scoreBox(page, before.homeTeam)).toHaveText(String(before.homeScore));
    // Subscriptions are per-connection and were intentionally not persisted.
    await expect(page.getByText(/no match selected/i)).toBeVisible();
  });
});
