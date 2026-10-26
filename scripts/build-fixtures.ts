/**
 * Builds a sustained, realistic commentary feed for every fixture.
 *
 * Why this exists: a fixture stays `live` for its whole time window (up to a few
 * hours), so a feed of a dozen entries runs dry in seconds and the dashboard
 * shows a frozen score with an empty ticker. The reference implementation
 * (adrianhajdin/sportz-websockets) solves this by streaming a long feed at a
 * fixed interval; this module supplies that long feed.
 *
 * Each fixture gets a scripted opening and closing plus a generated middle,
 * interleaved so the sequence reads like a real broadcast rather than a list of
 * repeated templates. Output is written to `data/feed.json`, which keeps this
 * generation out of the runtime path.
 *
 * Run: npm run fixtures:build
 */
import { writeFile } from "node:fs/promises";

import { FIXTURES, type FixtureProfile, type ScriptedEvent } from "../data/fixtures.ts";

/** Target entries per fixture. ~10 fixtures × 70 ≈ 700 rows. */
const TARGET_EVENTS = 70;

/**
 * Maximum game clock per sport, and how long one filler beat lasts.
 *
 * Minutes must stay inside the real clock: a basketball game is 48 minutes, so
 * a generated `121'` is nonsense. Filler advances the clock by a small step and
 * the value is clamped, which also means a repeated pass does not run past the
 * end of the game.
 */
const CLOCK: Record<string, { max: number; stepMin: number; stepMax: number }> = {
  football: { max: 90, stepMin: 1, stepMax: 3 },
  basketball: { max: 48, stepMin: 1, stepMax: 2 },
  cricket: { max: 0, stepMin: 0, stepMax: 0 },
};

/* ------------------------------------------------------------------ */
/* Commentary templates per sport, split into "any time" and "big moment" */
/* ------------------------------------------------------------------ */

const FOOTBALL = {
  general: [
    "{actor} drives forward and wins a throw on the halfway line.",
    "Patient build-up from {team}, probing for a gap.",
    "{actor} switches the play with a raking diagonal.",
    "Crowd rising — {team} are pressing high now.",
    "{actor} wins a free kick 30 yards out.",
    "Corner for {team}. Everyone forward for this.",
    "{actor} whips it in, headed clear at the near post.",
    "Possession has been {team}'s for the last few minutes.",
    "{actor} tries the through ball — just too much weight on it.",
    "Good recovery from {actor} after losing the ball.",
    "Tempo dropping a little as both sides catch their breath.",
    "Sustained pressure from {team} but nothing to show for it yet.",
  ],
  moment: [
    "CHANCE! {actor} curls one just past the far post.",
    "Big save! {actor} tips it over the bar.",
    "Off the bar! {actor} is inches away.",
    "Booked. {actor} goes into the referee's notebook.",
    "Goal disallowed — offside against {actor}.",
    "Substitution: {team} make a change.",
  ],
};

const CRICKET = {
  general: [
    "{actor} defends solidly, no run.",
    "Single taken, good running between the wickets.",
    "{actor} pushes into the gap for two.",
    "Dot ball, probing line from the bowler.",
    "{actor} leaves it outside off. Good discipline.",
    "Tight over, just one from it.",
    "{actor} rotates the strike with a nudge to leg.",
    "Appeal for lbw — turned down, looked to be going down leg.",
    "Fielding change, sweeper moved out to the boundary.",
    "{actor} plays and misses, beaten by the movement.",
  ],
  moment: [
    "FOUR! {actor} threads the covers, beautifully timed.",
    "SIX! {actor} goes downtown — that is huge.",
    "WICKET! {actor} is beaten and the bails are off.",
    "WICKET! Caught at slip — {actor} has to go.",
    "FIFTY! {actor} raises the bat for a superb half-century.",
    "Dropped! A regulation chance goes down off {actor}.",
  ],
};

const BASKETBALL = {
  general: [
    "{actor} brings the ball up court.",
    "Good defensive rotation from {team}.",
    "{actor} misses the mid-range jumper, rebound is gathered.",
    "Screen set, {actor} comes off it and swings the ball.",
    "Shot clock winding down — {actor} has to force it.",
    "Foul called. {team} will inbound.",
    "Fast break opportunity squandered by a loose pass.",
    "{actor} backs his man down in the post.",
    "Great help defence, shot contested.",
    "Timeout on the floor, both benches up.",
  ],
  moment: [
    "THREE! {actor} buries it from the wing.",
    "SLAM! {actor} throws it down on the break.",
    "And-one! {actor} finishes through the contact.",
    "Blocked! {actor} rejects it at the rim.",
    "Steal and score — {actor} punishes the turnover.",
    "Technical foul on the bench.",
  ],
};

const TEMPLATES = { football: FOOTBALL, cricket: CRICKET, basketball: BASKETBALL };

/** Period progression per sport, derived from how the script ends. */
function periodsFor(fixture: FixtureProfile): string[] {
  if (fixture.sport === "football") return ["First Half", "Second Half"];
  if (fixture.sport === "basketball") return ["Q1", "Q2", "Q3", "Q4"];
  // Cricket: a Test is multi-day; everything else is a single innings per side.
  return fixture.events.some((event) => event.period.includes("Day"))
    ? ["Day 1", "Day 2", "Day 3", "Day 4"]
    : ["1st Innings", "2nd Innings"];
}

/** Every distinct player/team name mentioned by a fixture. */
function castFor(fixture: FixtureProfile): { actors: string[]; teams: string[] } {
  const teams = [fixture.homeTeam, fixture.awayTeam];
  const actors = [
    ...new Set(
      fixture.events
        .map((event) => event.actor)
        .filter((actor): actor is string => typeof actor === "string" && actor.length > 0)
    ),
  ];

  // Pad the cast so the feed does not read like the same two names on repeat.
  const filler: Record<string, string[]> = {
    football: ["Rodri", "Saka", "Bellingham", "Vinícius Jr", "Kane", "Barella", "Musiala", "Palmer"],
    cricket: ["Kohli", "Root", "Smith", "Babar", "Williamson", "Stokes", "Head", "Jadeja"],
    basketball: ["LeBron James", "Tatum", "Curry", "Jokić", "Giannis", "Butler", "Dončić", "Edwards"],
  };
  for (const name of filler[fixture.sport] ?? []) {
    if (actors.length >= 8) break;
    if (!actors.includes(name)) actors.push(name);
  }

  return { actors, teams };
}

function fill(template: string, actor: string, team: string): string {
  return template.replaceAll("{actor}", actor).replaceAll("{team}", team);
}

/**
 * Deterministic pseudo-random pick, so regenerating the feed produces the same
 * file and a diff stays reviewable.
 */
function makePicker(seedText: string) {
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
  }
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

/**
 * Interleaves sport-accurate filler between the fixture's scripted beats and
 * copies the score state forward, so the scoreboard only ever moves when the
 * script says it does.
 */
function expand(fixture: FixtureProfile): ScriptedEvent[] {
  const random = makePicker(`${fixture.homeTeam}:${fixture.awayTeam}`);
  const { actors, teams } = castFor(fixture);
  const templates = TEMPLATES[fixture.sport];
  const periods = periodsFor(fixture);
  const isCricket = fixture.sport === "cricket";

  const scripted = fixture.events;
  // Spread the filler evenly between the scripted beats so the real moments
  // keep their intended spacing and the ticker has enough depth to keep
  // flowing for a long time.
  const fillerTarget = Math.max(0, TARGET_EVENTS - scripted.length);
  const perBeat = Math.max(1, Math.round(fillerTarget / Math.max(1, scripted.length)));

  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)];

  const out: ScriptedEvent[] = [];
  let home = 0;
  let away = 0;
  let homeWickets = 0;
  let awayWickets = 0;
  let minute = 0;

  const clock = CLOCK[fixture.sport] ?? CLOCK.football;

  const emitFiller = (period: string) => {
    const isBigMoment = random() < 0.28;
    const actor = pick(actors);
    const team = random() < 0.5 ? teams[0] : teams[1];
    const template = isBigMoment ? pick(templates.moment) : pick(templates.general);

    minute = Math.min(clock.max, minute + clock.stepMin + Math.floor(random() * clock.stepMax));

    // Filler never changes the score: only the scripted beats do, which keeps
    // the scoreline coherent with the narrative.
    out.push({
      minute: isCricket ? null : minute,
      period,
      message: fill(template, actor, team),
      eventType: "info",
      actor,
      team,
      tags: isBigMoment ? ["chance"] : ["passage"],
      homeScore: home,
      awayScore: away,
      homeWickets,
      awayWickets,
    });
  };

  scripted.forEach((event, index) => {
    const period = event.period || periods[Math.min(periods.length - 1, Math.floor((index / scripted.length) * periods.length))];

    // Filler beats leading into each scripted moment.
    for (let n = 0; n < perBeat; n += 1) emitFiller(period);

    // Copy the score state forward so every entry renders a consistent board.
    if (typeof event.homeScore === "number") home = event.homeScore;
    if (typeof event.awayScore === "number") away = event.awayScore;
    if (typeof event.homeWickets === "number") homeWickets = event.homeWickets;
    if (typeof event.awayWickets === "number") awayWickets = event.awayWickets;

    out.push({
      ...event,
      homeScore: home,
      awayScore: away,
      homeWickets,
      awayWickets,
    });
  });

  return out;
}

async function main() {
  const feed = FIXTURES.map((fixture) => ({
  sport: fixture.sport,
  homeTeam: fixture.homeTeam,
  awayTeam: fixture.awayTeam,
  competition: fixture.competition,
  venue: fixture.venue,
    events: expand(fixture),
  }));

  const target = new URL("../data/feed.json", import.meta.url);
  await writeFile(target, `${JSON.stringify(feed, null, 2)}\n`, "utf8");

  const total = feed.reduce((sum, entry) => sum + entry.events.length, 0);
  console.log(`✓ wrote data/feed.json — ${feed.length} fixtures, ${total} commentary entries`);
  for (const entry of feed) {
    console.log(
      `   ${String(entry.events.length).padStart(3)}  ${entry.homeTeam} v ${entry.awayTeam} (${entry.sport})`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
