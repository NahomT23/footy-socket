#!/usr/bin/env node
/**
 * Sportz simulation engine.
 *
 * Creates every fixture from `data/feed.json` through the public REST API and
 * then streams play-by-play + score updates at a fixed interval — the same
 * shape as the reference implementation
 * (adrianhajdin/sportz-websockets/src/seed/seed.js), which keeps a live ticker
 * running instead of firing a short burst and going quiet.
 *
 * Two behaviours matter for a believable demo:
 *
 *   • `--force-live` (default) back-dates every fixture so it sits inside its
 *     live window. A match that is "live" but whose window has expired would be
 *     corrected to `finished` by the status sweeper moments later.
 *   • the feed loops forever, so scores and commentary keep arriving for as long
 *     as you leave it running (Ctrl-C to stop).
 *
 * Usage:
 *   npm run seed                       # loop forever at ~1.2s per event
 *   npm run seed -- --speed 4          # four times faster
 *   npm run seed -- --no-loop          # single pass, then exit
 *   npm run seed -- --once             # create fixtures only, no streaming
 *   npm run seed -- --sport football   # one sport only
 *   npm run seed -- --no-force-live    # keep each fixture's scripted state
 *   npm run seed -- --no-reset         # append instead of clearing the database
 *
 * The script talks to the app exactly like a browser does: if a route rejects a
 * payload, the simulator surfaces the same error a client would see.
 */
import { PrismaClient } from "@prisma/client";

import { FIXTURES } from "../data/fixtures.ts";
import { FEED } from "../data/feed.ts";
import { ApiError, DEFAULT_BASE_URL, apiFetch, jitter, log, paint, parseArgs, sleep } from "./lib/http.mjs";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** Wall-clock milliseconds between events at speed 1. */
const BASE_INTERVAL_MS = 1_200;

/** How long a fixture is scheduled to last, per sport (minutes). */
const DURATION_MINUTES = {
  football: 120,
  cricket: 360,
  basketball: 150,
};

const { flags } = parseArgs();

if (flags.help) {
  console.log(`
Sportz simulation engine

  --url <url>       Base URL of the Sportz server   (default ${DEFAULT_BASE_URL})
  --speed <n>       Playback multiplier             (default 1)
  --interval <ms>   Base gap between events         (default ${BASE_INTERVAL_MS})
  --loop            Repeat the feed forever         (default: on)
  --no-loop         Stream one pass, then exit
  --once            Create fixtures only, no streaming
  --sport <name>    football | cricket | basketball
  --force-live      Back-date fixtures into a live window (default: on)
  --no-force-live   Keep each fixture's scripted state
  --no-reset        Keep existing data (default: wipe first)
  --help            Show this message
`);
  process.exit(0);
}

const baseUrl = String(flags.url ?? DEFAULT_BASE_URL);
const speed = flags.once ? Infinity : Math.max(0.25, Number(flags.speed ?? 1));
const once = Boolean(flags.once);
/** Loop by default: the ticker should not stop while the app is being demoed. */
const loop = !once && flags.noLoop !== true;
/** Back-date fixtures so they are genuinely inside their live window. */
const forceLive = flags.noForceLive !== true;
const baseIntervalMs = Number(flags.interval ?? 1_200);
const reset = flags.noReset !== true;
const sportFilter = flags.sport ? String(flags.sport) : null;

if (sportFilter && !["football", "cricket", "basketball"].includes(sportFilter)) {
  console.error(paint.red(`Unknown sport "${sportFilter}". Use football, cricket or basketball.`));
  process.exit(1);
}

const fixtures = sportFilter ? FIXTURES.filter((fixture) => fixture.sport === sportFilter) : FIXTURES;

/**
 * The expanded feed (`npm run fixtures:build`) keyed by "home|away". It carries
 * the same scripted beats plus enough filler to keep a ticker alive for minutes
 * rather than seconds.
 */
const feedByFixture = new Map(
  FEED.map((entry) => [`${entry.homeTeam}|${entry.awayTeam}`, entry.events])
);

function eventsFor(fixture) {
  const expanded = feedByFixture.get(`${fixture.homeTeam}|${fixture.awayTeam}`);
  if (!expanded || expanded.length === 0) {
    throw new Error(
      `No generated feed for ${fixture.homeTeam} v ${fixture.awayTeam}. Run: npm run fixtures:build`
    );
  }
  return expanded;
}

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Time windows                                                        */
/* ------------------------------------------------------------------ */

/**
 * Turns a fixture profile into concrete start/end timestamps.
 *
 * Live fixtures are back-dated so they are unambiguously in progress; scheduled
 * fixtures start in the future; finished fixtures sit entirely in the past.
 */
function computeWindow(fixture) {
  const now = Date.now();
  const durationMinutes = DURATION_MINUTES[fixture.sport] ?? 120;

  // A fixture marked "live" must genuinely sit inside its window: the server
  // derives status from these times, and the sweeper would flip an expired
  // fixture to `finished` moments after it was created.
  if (forceLive) {
    const startTime = new Date(now - 5 * 60_000);
    return { startTime, endTime: new Date(startTime.getTime() + durationMinutes * 60_000) };
  }

  if (fixture.state === "scheduled") {
    const startTime = new Date(now + (fixture.startsInMinutes ?? 60) * 60_000);
    return { startTime, endTime: new Date(startTime.getTime() + durationMinutes * 60_000) };
  }

  if (fixture.state === "finished") {
    const endTime = new Date(now - 5 * 60_000);
    return {
      startTime: new Date(endTime.getTime() - (fixture.durationMinutes ?? durationMinutes) * 60_000),
      endTime,
    };
  }

  // Live: default the elapsed time to the last scripted event so the game clock
  // in the UI matches the commentary that is about to be streamed.
  const lastMinute = [...fixture.events]
    .reverse()
    .find((event) => typeof event.minute === "number")?.minute;
  const elapsed = fixture.startedMinutesAgo ?? lastMinute ?? 15;

  const startTime = new Date(now - elapsed * 60_000);
  return { startTime, endTime: new Date(startTime.getTime() + durationMinutes * 60_000) };
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

async function preflight() {
  try {
    const response = await fetch(new URL("/healthz", baseUrl));
    if (!response.ok) throw new Error(`status ${response.status}`);
    const health = await response.json();
    log("preflight", `${paint.green("server up")} — ${health.sockets} socket(s), ${health.rooms} room(s)`);
  } catch (error) {
    console.error(paint.red(`\n  Cannot reach the Sportz server at ${baseUrl}`));
    console.error(paint.dim(`  ${error.message}`));
    console.error(paint.dim("\n  Start it first:  npm run dev\n"));
    process.exit(1);
  }
}

async function resetDatabase() {
  const { count } = await prisma.match.deleteMany({});
  log("reset", `removed ${paint.yellow(count)} existing fixture(s) and their commentary`);
}

/* ------------------------------------------------------------------ */
/* Fixture creation                                                    */
/* ------------------------------------------------------------------ */

async function createFixture(fixture) {
  const { startTime, endTime } = computeWindow(fixture);

  const body = {
    sport: fixture.sport,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };

  // `--once` has no stream to build a score, and `--no-force-live` re-creates
  // scripted scheduled/finished fixtures whose windows the score route would
  // refuse to stream into anyway — both ship their authored result outright.
  // When streaming a live window (the default), the board starts at 0-0 and
  // the narrative pushes every point and wicket itself: seeding the final
  // score up front would make the stream's very first update a "decrease"
  // (409 CONFLICT) and freeze that fixture's scoreboard for the whole run.
  if (once || !forceLive) {
    body.homeScore = fixture.finalScore?.home ?? 0;
    body.awayScore = fixture.finalScore?.away ?? 0;

    // Cricket carries two extra dimensions that make the scoreline meaningful.
    if (fixture.sport === "cricket") {
      body.homeWickets = fixture.finalWickets?.home ?? 0;
      body.awayWickets = fixture.finalWickets?.away ?? 0;
    }

    // A concluded fixture states its outcome outright instead of leaving the UI
    // to infer one from scores that may come from different innings.
    if (fixture.result) body.result = fixture.result;
  }

  const match = await apiFetch(baseUrl, "/api/matches", { method: "POST", body });

  log(
    "create",
    `${paint.bold(`${fixture.homeTeam} vs ${fixture.awayTeam}`)} ${paint.dim(`[${fixture.competition}]`)} ` +
      `${paint.cyan(`#${match.id}`)} ${paint.magenta(match.status)}`
  );

  return match;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

/**
 * Streams one fixture's script into the API.
 *
 * Ordering guarantee: `sequence` is strictly increasing, so the feed renders in
 * the intended chronological order regardless of arrival jitter. Score updates
 * are sent in the same tick as the commentary that caused them, which is what
 * makes the dashboard flash a score and show the matching line together.
 */
async function streamFixture(fixture, match, { index, total }) {
  const scope = `#${match.id}`;
  const isCricket = fixture.sport === "cricket";
  const events = eventsFor(fixture);

  let pass = 0;

  // One pass = one full loop of the generated feed. With `--no-loop` the run
  // stops after a single pass; otherwise it repeats until interrupted.
  for (;;) {
    pass += 1;
    let sequence = 0;
    let home = match.homeScore;
    let away = match.awayScore;
    let homeWickets = match.homeWickets ?? 0;
    let awayWickets = match.awayWickets ?? 0;
    let battingSide = "home";
    let overs = fixture.oversBaseline ?? "0.0";

    // Sequence numbers are unique per fixture, so a new pass has to start from a
    // free block rather than colliding with the previous one.
    const sequenceBase = (pass - 1) * events.length;

    if (pass > 1) {
      // Replay the narrative from the top. Clearing this fixture's commentary
      // keeps the demo database small during a long-running ticker, and starts
      // the middle order at a genuinely fresh score.
      //
      // The rollback goes through Prisma on purpose: the score route refuses
      // any decreasing value on behalf of real clients, but the simulator owns
      // this database and legitimately needs to wind the board back to 0.
      // (A silent PATCH-then-ignore here used to leave the local counters at 0
      // against a database that still held pass 1's score, so every later
      // score update was rejected with "Scores cannot decrease".)
      await prisma.$transaction([
        prisma.commentary.deleteMany({ where: { matchId: match.id } }),
        prisma.match.update({
          where: { id: match.id },
          data: {
            homeScore: 0,
            awayScore: 0,
            homeWickets: 0,
            awayWickets: 0,
            homeOvers: null,
            awayOvers: null,
          },
        }),
      ]);

      home = 0;
      away = 0;
      homeWickets = 0;
      awayWickets = 0;
      battingSide = "home";
      log(scope, paint.dim(`↻ replaying the feed (pass ${pass})`));
    }

    for (const event of events) {
      sequence += 1;

      // A new innings restarts the incoming side's runs AND wickets.
      if (isCricket && event.battingSide && event.battingSide !== battingSide) {
        battingSide = event.battingSide;
        if (battingSide === "home") {
          home = 0;
          homeWickets = 0;
        } else {
          away = 0;
          awayWickets = 0;
        }
        log(scope, paint.cyan(`innings change — ${battingSide === "home" ? fixture.homeTeam : fixture.awayTeam} to bat`));
      }

      if (isCricket && event.overs) overs = event.overs;

      let commentary;
      try {
        commentary = await apiFetch(baseUrl, `/api/matches/${match.id}/commentary`, {
          method: "POST",
          body: {
            minute: event.minute ?? null,
            sequence: sequenceBase + sequence,
            period: event.period,
            eventType: event.eventType,
            actor: event.actor ?? null,
            team: event.team ?? null,
            message: event.message,
            metadata: {
              ...(event.metadata ?? {}),
              ...(isCricket && event.overs ? { over: event.overs } : {}),
            },
            tags: event.tags ?? [],
          },
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          log(scope, paint.dim("fixture disappeared (database reset) — stopping stream"));
          return;
        }
        throw error;
      }

      log(
        scope,
        `${paint.dim(`[${index + 1}/${total}]`)} ${paint.bold(event.eventType.toUpperCase().padEnd(12))} ` +
          `${paint.dim(isCricket ? (event.overs ?? overs) : event.minute !== null ? `${event.minute}'` : event.period)} ` +
          `seq=${commentary.sequence} ${event.message.slice(0, 56)}${event.message.length > 56 ? "…" : ""}`
      );

      // Only push a score when the script actually moves it.
      const nextHome = event.homeScore ?? home;
      const nextAway = event.awayScore ?? away;
      const nextHomeWickets = event.homeWickets ?? homeWickets;
      const nextAwayWickets = event.awayWickets ?? awayWickets;

      const scoreChanged =
        nextHome !== home ||
        nextAway !== away ||
        nextHomeWickets !== homeWickets ||
        nextAwayWickets !== awayWickets;

      if (scoreChanged) {
        try {
          await apiFetch(baseUrl, `/api/matches/${match.id}/score`, {
            method: "PATCH",
            body: {
              homeScore: nextHome,
              awayScore: nextAway,
              ...(isCricket
                ? {
                    homeWickets: nextHomeWickets,
                    awayWickets: nextAwayWickets,
                    homeOvers: battingSide === "home" ? overs : null,
                    awayOvers: battingSide === "away" ? overs : null,
                  }
                : {}),
            },
          });

          home = nextHome;
          away = nextAway;
          homeWickets = nextHomeWickets;
          awayWickets = nextAwayWickets;

          const line = isCricket
            ? `${fixture.homeTeam} ${home}/${homeWickets} — ${fixture.awayTeam} ${away}/${awayWickets} (${overs} ov)`
            : `${fixture.homeTeam} ${home}–${away} ${fixture.awayTeam}`;
          log(scope, `${paint.green("score")} ${line}`);
        } catch (error) {
          if (error instanceof ApiError && error.code === "CONFLICT") {
            // Only possible for a scheduled/finished fixture under
            // --no-force-live. Carry on streaming commentary.
            log(scope, paint.dim(`score rejected (${error.message})`));
          } else {
            throw error;
          }
        }
      }

      if (!once) {
        await sleep(jitter(baseIntervalMs / speed, baseIntervalMs / 2 / speed));
      }
    }

    if (!loop) break;
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const startedAt = Date.now();

  console.log(
    `\n${paint.bold(paint.yellow(" SPORTZ "))} ${paint.dim("simulation engine")}  ` +
      `${paint.cyan(fixtures.length)} fixture(s)  ${paint.cyan(baseUrl)}  ` +
      `${paint.cyan(once ? "instant" : `${speed}x`)}  ` +
      `${paint.cyan(loop ? "looping" : "single pass")}  ` +
      `${paint.cyan(forceLive ? "forced live" : "scripted states")}\n`
  );

  await preflight();
  if (reset) await resetDatabase();

  // Create everything first so the dashboard lights up immediately, then stream.
  const streamable = [];
  for (const fixture of fixtures) {
    const match = await createFixture(fixture);
    if (!once) streamable.push({ fixture, match });
  }

  if (once) {
    console.log(`\n${paint.green("✓")} Seeded ${fixtures.length} fixture(s) in ${Date.now() - startedAt}ms`);
  } else if (streamable.length > 0) {
    console.log(
      loop
        ? `\n${paint.dim("Streaming live. The ticker loops until you press Ctrl-C.")}\n`
        : `\n${paint.dim("Streaming play-by-play. Open the dashboard and press “Watch live”.")}\n`
    );

    // Fixtures stream concurrently so the dashboard receives interleaved
    // traffic across rooms — exactly like a real match day.
    const results = await Promise.allSettled(
      streamable.map(({ fixture, match }, index) =>
        streamFixture(fixture, match, { index, total: streamable.length })
      )
    );

    const failed = results.filter((result) => result.status === "rejected");
    for (const failure of failed) {
      console.error(paint.red(`  ✗ ${failure.reason?.message ?? failure.reason}`));
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (failed.length > 0) {
      console.log(`\n${paint.red("✗")} Finished with ${failed.length} failed stream(s) in ${elapsed}s`);
    } else {
      console.log(`\n${paint.green("✓")} All stream(s) complete in ${elapsed}s`);
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(paint.red(`\n✗ Simulation failed: ${error.message}`));
  if (error instanceof ApiError && error.code) {
    console.error(paint.dim(`  code: ${error.code}  status: ${error.status}`));
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
