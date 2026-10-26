/**
 * ESPN provider adapter.
 *
 * One scoreboard API serves every sport we show today
 * (soccer `eng.1`/`esp.1`/…, basketball `nba`, and more) with no API key.
 * Source of truth for shapes: https://site.api.espn.com/apis/site/v2
 *
 * This module is deliberately plain Node ESM so `server.mjs` can import it
 * without a build step. It never talks to the database — it only fetches and
 * normalises. Persistence, diffing and emission live in `lib/ingest.mjs`.
 *
 * Normalised shapes (the whole point of this file — the ingest layer should
 * never have to know what ESPN's JSON looks like):
 *
 *   NormalisedMatch {
 *     externalId, sport, competition, homeTeam, awayTeam, homeTla, awayTla,
 *     status: "scheduled" | "live" | "finished",
 *     startTime (ISO), endTime (ISO, synthesised), homeScore, awayScore,
 *     result (string | null),
 *     providerSeq: number  // ESPN event id, for dedupe/debug only
 *   }
 *
 *   NormalizedCommentary {
 *     sequence (unique per match), minute | null, period, eventType, actor,
 *     team (abbr), message, metadata
 *   }
 */

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const USER_AGENT = "sportz-dashboard/1.0 (personal demo)";

/** Synthesised fixture length per sport (provider rows have no scripted end). */
const DURATION_MINUTES = {
  football: 120,
  cricket: 360,
  basketball: 150,
};

/** The sports this project knows about; rl: anything else is rejected. */
const KNOWN_SPORTS = new Set(["football", "cricket", "basketball"]);

/** Default league set: your current fixtures' world + the NBA. */
export const DEFAULT_LEAGUES_SPEC = "football:eng.1,football:esp.1,basketball:nba";

/**
 * Parses `"football:eng.1,football:esp.1,basketball:nba"` into league rows.
 * Unknown sports are skipped (and a `warn` array is returned for logging).
 */
export function parseLeagues(spec = DEFAULT_LEAGUES_SPEC) {
  const leagues = [];
  const warnings = [];
  for (const token of String(spec ?? "").split(",")) {
    const entry = token.trim();
    if (!entry) continue;
    const [sport, slug] = entry.split(":");
    if (!KNOWN_SPORTS.has(sport) || !slug) {
      warnings.push(entry);
      continue;
    }
    leagues.push({ sport, slug });
  }
  return { leagues, warnings };
}

/** `2026-10-25T14:00Z` -> `"20261025"` for ESPN's `?dates=` parameter. */
export function yyyymmdd(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Our sport name -> ESPN's URL path segment (football is "soccer" there). */
const ESPN_SPORT_PATH = {
  football: "soccer",
  basketball: "basketball",
  cricket: "cricket",
};

async function fetchJson(url, timeoutMs = 10_000) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`ESPN responded ${response.status} for ${url}`);
  }
  return response.json();
}

/** ESPN `state` -> this app's MatchStatus. `in` covers halftime/quarter break. */
function mapStatus(typeState) {
  if (typeState === "post") return "finished";
  if (typeState === "in") return "live";
  return "scheduled";
}

/**
 * Pulls the home/away pair out of an event defensively: ESPN always sends
 * `competitions[0].competitors` in [home, away] order but marks `homeAway`
 * explicitly, so honour the flag rather than array order.
 */
function competitorsOf(event) {
  const competitors = event?.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
  return { home, away };
}

const toInt = (value) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * `"45'+2'"` -> 45 (stoppage folds into the minute), `"12.5"` (clock seconds
 * left in the period for US sports) -> null (the period label carries that).
 */
function minuteOf(soccerClock) {
  const raw = soccerClock?.displayValue ?? "";
  const match = /^(\d+)/.exec(raw);
  if (match) return Number(match[1]);
  return null;
}

function resultLine(match) {
  if (
    match.status !== "finished" ||
    (match.homeScore === 0 && match.awayScore === 0)
  ) {
    return null;
  }
  return match.homeScore === match.awayScore
    ? "Draw"
    : `${match.homeScore > match.awayScore ? match.homeTeam : match.awayTeam} win ${match.homeScore}-${match.awayScore}`;
}

/**
 * Normalises one ESPN event into a row-shaped plain object. `providerSeq`
 * keeps ESPN's own event id for dedupe/debug; `externalId` is unique per
 * league because ESPN ids are only unique within their sport.
 */
function normalizeEvent(event, { sport, league }) {
  const startTime = event?.date ?? null;
  if (!startTime || !event?.id) return null;

  const { home, away } = competitorsOf(event);
  if (!home?.team || !away?.team) return null;

  const status = mapStatus(event?.status?.type?.state);
  const start = new Date(startTime);
  const endTime = new Date(start.getTime() + DURATION_MINUTES[sport] * 60_000);

  return {
    providerSeq: toInt(event.id),
    externalId: `${league.slug}:${event.id}`,
    sport,
    competition: league.name,
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    homeTla: home.team.abbreviation ?? null,
    awayTla: away.team.abbreviation ?? null,
    status,
    startTime,
    endTime,
    homeScore: toInt(home.score),
    awayScore: toInt(away.score),
    result: resultLine({
      status,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeScore: toInt(home.score),
      awayScore: toInt(away.score),
    }),
  };
}

/**
 * Maps one soccer scoring-play detail entry onto a Commentary row. NBA live
 * plays come from `fetchSummary` instead (the scoreboard does not carry a
 * play stream for US sports) nuso that path has its own mapper below.
 */
function mapSoccerDetail(detail, index) {
  const typeText = detail?.type?.text ?? "";
  const athlete =
    detail?.athletesInvolved?.[0]?.displayName ??
    detail?.athletesInvolved?.[0]?.fullName ?? null;
  const penalty = detail?.penaltyKick === true;
  const ownGoal = detail?.ownGoal === true;

  let eventType = "info";
  let message;
  if (detail?.scoringPlay === true) {
    eventType = "goal";
    if (ownGoal) message = `${athlete ?? "An own goal"} turns it into his own net.`;
    else if (penalty) message = `GOAL! ${athlete ?? "A penalty"} converts from the spot.`;
    else message = `GOAL! ${athlete ?? "The striker"} finds the net${typeText && !typeText.startsWith("Goal") ? ` (${typeText})` : ""}.`;
  } else if (/red/i.test(typeText)) {
    eventType = "card";
    message = `RED CARD! ${athlete ?? "A player"} is sent off.`;
  } else if (/yellow/i.test(typeText)) {
    eventType = "card";
    message = `Yellow card for ${athlete ?? "a player"}.`;
  } else {
    message = typeText || "Match event.";
  }

  return {
    sequence: index + 1, // ESPN details are already in chronological order
    minute: minuteOf(detail?.clock),
    period: minuteOf(detail?.clock) !== null ? "In play" : null,
    eventType,
    actor: athlete,
    team: detail?.team?.id ?? null,
    message,
    metadata: { type: typeText, clock: detail?.clock?.displayValue ?? null },
  };
}

/**
 * Fetches one league's scoreboard for a calendar day and normalises it.
 *
 * Returns `{ matches, eventsByExternalId }` — `eventsByExternalId` maps the
 * externalId to *already normalised commentary*, because the soccer scoreboard
 * carries its scoring timeline inline (no extra request needed).
 */
export async function fetchScoreboard({ sport, slug }, day, timeoutMs) {
  const url = `${ESPN_BASE}/${ESPN_SPORT_PATH[sport]}/${slug}/scoreboard?dates=${yyyymmdd(day)}`;
  const json = await fetchJson(url, timeoutMs);

  const league = slugToLeague(json, slug);
  const matches = [];
  const eventsByExternalId = new Map();

  for (const event of json?.events ?? []) {
    const match = normalizeEvent(event, { sport, league });
    if (!match) continue;
    matches.push(match);

    if (sport === "football") {
      const details = event?.competitions?.[0]?.details ?? [];
      if (details.length > 0) {
        eventsByExternalId.set(
          match.externalId,
          details.map((detail, index) => {
            const normalized = mapSoccerDetail(detail, index);
            return {
              ...normalized,
              team: teamNameForId(detail?.team?.id, competitorsOf(event)),
            };
          })
        );
      }
    }
  }

  return { leagueName: league.name, matches, eventsByExternalId };
}

/** League metadata (name) straight off the response, with a safe fallback. */
function slugToLeague(json, slug) {
  const name = json?.leagues?.[0]?.name;
  return { slug, name: name || slug };
}

/** Maps ESPN's team *id* reference to the abbr shown in the feed. */
function teamNameForId(teamId, { home, away }) {
  if (teamId == null) return null;
  if (String(home?.team?.id) === String(teamId)) return home.team.abbreviation;
  if (String(away?.team?.id) === String(teamId)) return away.team.abbreviation;
  return null;
}

/**
 * Live play-by-play for one fixture. `summary` is where ESPN's US-sport
 * commentary actually lives; we keep *only scoring plays and period starts*
 * so the DB stays lean while remaining lively.
 */
export async function fetchSummary({ sport, slug, eventId }, timeoutMs) {
  const url = `${ESPN_BASE}/${ESPN_SPORT_PATH[sport] ?? sport}/${slug}/summary?event=${encodeURIComponent(eventId)}`;
  const json = await fetchJson(url, timeoutMs);

  const plays = json?.plays ?? [];

  /** Keeps basketball scoring plays; drops rebounds/whistles/misses. */
  const keep = plays.filter((play) => play?.scoringPlay === true);
  const periodBreaks = plays.filter(
    (play) => /Start Period|End Period|End Game/.test(play?.type?.text ?? "")
  );

  const selected = [...periodBreaks, ...keep].sort((a, b) =>
    Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0)
  );

  let lastSequence = 0;
  const commentary = selected.map((play) => {
    const sequence = toInt(play.sequenceNumber ?? 0);
    lastSequence = Math.max(lastSequence, sequence);
    const period = play?.period?.displayValue ?? null;
    const typeText = play?.type?.text ?? "";
    const three = typeText.includes("3-pt");
    const actor = play?.participants?.find((entry) => entry?.athlete)?.athlete ?? null;

    let eventType = "info";
    let message = play?.text ?? typeText;
    if (play?.scoringPlay === true) {
      eventType = three ? "three" : "basket";
      message = `${typeText}: ${message}`;
    }

    return {
      sequence,
      minute: null,
      period,
      eventType,
      actor: actor?.displayName ?? null,
      team: null, // filled by ingest from the cached score/competitors map
      message,
      metadata: {
        type: typeText,
        clock: play?.clock?.displayValue ?? null,
        provider: "espn-detail",
      },
    };
  });

  return { commentary, lastSequence };
}

export { fetchJson as _fetchJson };
