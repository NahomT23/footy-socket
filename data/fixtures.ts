/**
 * Fixture profiles and scripted play-by-play used by the simulation engine.
 *
 * Typed, checked into source control and imported by `scripts/seed.mjs` via
 * tsx. Each event carries sport-accurate vocabulary, an optional score delta
 * and the metadata the UI renders as chips.
 */
import type { EventType } from "@/lib/types";

export type FixtureState = "live" | "finished" | "scheduled";

export interface ScriptedEvent {
  /** Game minute (football) or null for period-only events. */
  minute: number | null;
  /** Sport-specific phase label: `1st Innings`, `Q3`, `Second Half`... */
  period: string;
  message: string;
  eventType: EventType;
  actor?: string;
  team?: string;
  /** Score to set for the home side when this event happens. */
  homeScore?: number;
  awayScore?: number;
  /** Cricket: wickets lost by the home side at this moment. */
  homeWickets?: number;
  /** Cricket: wickets lost by the away side at this moment. */
  awayWickets?: number;
  /**
   * Cricket: which innings this event belongs to. A change here means the other
   * side has come in to bat, so that side's runs/wickets restart at 0.
   */
  battingSide?: "home" | "away";
  /** Cricket: completed overs, e.g. `"18.2"`. Overrides the profile baseline. */
  overs?: string;
  tags?: string[];
  metadata?: Record<string, string | number>;
}

export interface FixtureProfile {
  sport: "football" | "cricket" | "basketball";
  homeTeam: string;
  awayTeam: string;
  venue: string;
  competition: string;
  state: FixtureState;
  /** Live: minutes elapsed at seed time. Scheduled: minutes until kickoff. */
  startedMinutesAgo?: number;
  startsInMinutes?: number;
  /** Finished: total duration of the match. */
  durationMinutes?: number;
  finalScore?: { home: number; away: number };
  /** Cricket: wickets lost in the final scoreline. */
  finalWickets?: { home: number; away: number };
  /**
   * Final outcome for a concluded fixture. Stored rather than inferred: in a
   * two-innings cricket match the two sides' run totals come from different
   * innings and are not comparable, so "who scored more" is the wrong question.
   */
  result?: string;
  /** Cricket: overs completed, used as the baseline for `over` metadata. */
  oversBaseline?: string;
  events: ScriptedEvent[];
}

export const FIXTURES: FixtureProfile[] = [
  /* ---------------------------------------------------------------- */
  /* Football                                                          */
  /* ---------------------------------------------------------------- */
  {
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Manchester City",
    venue: "Emirates Stadium",
    competition: "Premier League",
    state: "live",
    startedMinutesAgo: 52,
    events: [
      { minute: 0, period: "First Half", message: "Kick-off at the Emirates — Arsenal get us underway.", eventType: "start", tags: ["kickoff"] },
      { minute: 6, period: "First Half", message: "Saka drives at Gvardiol and wins the first corner of the night.", eventType: "info", actor: "Bukayo Saka", team: "Arsenal", tags: ["corner"] },
      { minute: 12, period: "First Half", message: "CHANCE! Haaland heads wide from De Bruyne's whipped cross.", eventType: "info", actor: "Erling Haaland", team: "Manchester City", metadata: { xg: 0.31 } },
      { minute: 19, period: "First Half", message: "GOAL! Ødegaard curls it into the far corner from the edge of the box.", eventType: "goal", actor: "Martin Ødegaard", team: "Arsenal", homeScore: 1, awayScore: 0, tags: ["goal", "screamer"], metadata: { xg: 0.08, distanceYards: 20 } },
      { minute: 24, period: "First Half", message: "Yellow card for Rodri after a cynical trip on Saka.", eventType: "card", actor: "Rodri", team: "Manchester City", tags: ["yellow"], metadata: { card: "yellow" } },
      { minute: 33, period: "First Half", message: "GOAL! Foden levels it with a low drive across Raya.", eventType: "goal", actor: "Phil Foden", team: "Manchester City", homeScore: 1, awayScore: 1, tags: ["goal"], metadata: { xg: 0.22 } },
      { minute: 45, period: "First Half", message: "Two minutes of added time signalled.", eventType: "stoppage", tags: ["added-time"], metadata: { addedMinutes: 2 } },
      { minute: 45, period: "Half Time", message: "Half time: Arsenal 1-1 Manchester City. All square after an electric 45.", eventType: "period", homeScore: 1, awayScore: 1, tags: ["halftime"] },
      { minute: 46, period: "Second Half", message: "Back underway. City make a change: Grealish replaces Doku.", eventType: "substitution", actor: "Jack Grealish", team: "Manchester City", tags: ["substitution"] },
      { minute: 58, period: "Second Half", message: "GOAL! Saka finishes a rapid counter-attack at the near post.", eventType: "goal", actor: "Bukayo Saka", team: "Arsenal", homeScore: 2, awayScore: 1, tags: ["goal", "counter"], metadata: { xg: 0.44 } },
      { minute: 67, period: "Second Half", message: "Big save! Raya tips Alvarez's header over the bar.", eventType: "info", actor: "David Raya", team: "Arsenal", tags: ["save"] },
      { minute: 74, period: "Second Half", message: "Penalty to Manchester City — handball against Saliba.", eventType: "foul", actor: "William Saliba", team: "Arsenal", tags: ["penalty", "var"], metadata: { decision: "penalty" } },
      { minute: 76, period: "Second Half", message: "GOAL! Haaland buries the penalty into the bottom left corner.", eventType: "goal", actor: "Erling Haaland", team: "Manchester City", homeScore: 2, awayScore: 2, tags: ["goal", "penalty"] },
      { minute: 84, period: "Second Half", message: "Arsenal pushing now — Rice's shot deflects just wide.", eventType: "info", actor: "Declan Rice", team: "Arsenal", tags: ["shot"] },
      { minute: 90, period: "Second Half", message: "Five minutes added on. Both sides chasing a winner.", eventType: "stoppage", tags: ["added-time"], metadata: { addedMinutes: 5 } },
    ],
  },
  {
    sport: "football",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    venue: "Santiago Bernabéu",
    competition: "La Liga",
    state: "live",
    startedMinutesAgo: 21,
    events: [
      { minute: 0, period: "First Half", message: "El Clásico is underway at the Bernabéu.", eventType: "start", tags: ["kickoff"] },
      { minute: 5, period: "First Half", message: "Yamal skins Mendy and forces a fingertip save from Courtois.", eventType: "info", actor: "Lamine Yamal", team: "Barcelona", tags: ["save"] },
      { minute: 11, period: "First Half", message: "GOAL! Vinícius Jr cuts inside and rifles it into the roof of the net.", eventType: "goal", actor: "Vinícius Júnior", team: "Real Madrid", homeScore: 1, awayScore: 0, tags: ["goal"], metadata: { xg: 0.17 } },
      { minute: 17, period: "First Half", message: "Yellow card for Araújo after hauling down Mbappé.", eventType: "card", actor: "Ronald Araújo", team: "Barcelona", tags: ["yellow"], metadata: { card: "yellow" } },
      { minute: 21, period: "First Half", message: "Bellingham's header clips the top of the crossbar.", eventType: "info", actor: "Jude Bellingham", team: "Real Madrid", metadata: { xg: 0.19 } },
    ],
  },
  {
    sport: "football",
    homeTeam: "Inter Milan",
    awayTeam: "Napoli",
    venue: "San Siro",
    competition: "Serie A",
    state: "scheduled",
    startsInMinutes: 45,
    events: [
      { minute: 0, period: "First Half", message: "Kick-off at the San Siro.", eventType: "start" },
      { minute: 9, period: "First Half", message: "GOAL! Lautaro Martínez opens the scoring from a tight angle.", eventType: "goal", actor: "Lautaro Martínez", team: "Inter Milan", homeScore: 1, awayScore: 0, tags: ["goal"] },
      { minute: 28, period: "First Half", message: "GOAL! Kvaratskhelia curls in the equaliser.", eventType: "goal", actor: "Khvicha Kvaratskhelia", team: "Napoli", homeScore: 1, awayScore: 1, tags: ["goal"] },
      { minute: 45, period: "Half Time", message: "Half time: 1-1.", eventType: "period" },
      { minute: 63, period: "Second Half", message: "GOAL! Thuram heads Inter back in front.", eventType: "goal", actor: "Marcus Thuram", team: "Inter Milan", homeScore: 2, awayScore: 1, tags: ["goal"] },
      { minute: 78, period: "Second Half", message: "Red card! Di Lorenzo is sent off for a second bookable offence.", eventType: "card", actor: "Giovanni Di Lorenzo", team: "Napoli", tags: ["red"], metadata: { card: "red" } },
      { minute: 90, period: "Second Half", message: "Full time at the San Siro: Inter 2-1 Napoli.", eventType: "end" },
    ],
  },
  {
    sport: "football",
    homeTeam: "Liverpool",
    awayTeam: "Chelsea",
    venue: "Anfield",
    competition: "Premier League",
    state: "finished",
    durationMinutes: 120,
    finalScore: { home: 3, away: 1 },
    result: "Liverpool win 3-1",
    events: [
      { minute: 0, period: "First Half", message: "Kick-off at Anfield.", eventType: "start" },
      { minute: 14, period: "First Half", message: "GOAL! Salah slots home from the spot.", eventType: "goal", actor: "Mohamed Salah", team: "Liverpool", homeScore: 1, awayScore: 0, tags: ["goal", "penalty"] },
      { minute: 38, period: "First Half", message: "GOAL! Palmer pulls one back with a free-kick.", eventType: "goal", actor: "Cole Palmer", team: "Chelsea", homeScore: 1, awayScore: 1, tags: ["goal"] },
      { minute: 52, period: "Second Half", message: "GOAL! Núñez powers in a header from the corner.", eventType: "goal", actor: "Darwin Núñez", team: "Liverpool", homeScore: 2, awayScore: 1, tags: ["goal"] },
      { minute: 88, period: "Second Half", message: "GOAL! Szoboszlai seals it on the break.", eventType: "goal", actor: "Dominik Szoboszlai", team: "Liverpool", homeScore: 3, awayScore: 1, tags: ["goal"] },
      { minute: 90, period: "Full Time", message: "Full time: Liverpool 3-1 Chelsea.", eventType: "end" },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Cricket                                                           */
  /* ---------------------------------------------------------------- */
  {
    sport: "cricket",
    homeTeam: "India",
    awayTeam: "Australia",
    venue: "M. Chinnaswamy Stadium",
    competition: "ODI Series",
    state: "live",
    startedMinutesAgo: 95,
    events: [
      { minute: null, period: "1st Innings", message: "India win the toss and choose to bat first.", eventType: "start", tags: ["toss"] },
      { minute: null, period: "1st Innings", message: "FOUR! Rohit Sharma punches Starc through the covers to open his account.", eventType: "info", actor: "Rohit Sharma", team: "India", homeScore: 4, overs: "0.3", metadata: { runs: 4 } },
      { minute: null, period: "1st Innings", message: "SIX! Gill launches Zampa over long-on.", eventType: "info", actor: "Shubman Gill", team: "India", homeScore: 29, overs: "3.2", metadata: { runs: 6 } },
      { minute: null, period: "1st Innings", message: "WICKET! Starc removes Rohit for 24, caught at mid-off.", eventType: "wicket", actor: "Mitchell Starc", team: "Australia", homeScore: 41, homeWickets: 1, overs: "5.1", metadata: { wicket: "Rohit Sharma 24 (19)" } },
      { minute: null, period: "1st Innings", message: "Fifty up for India in the 11th over.", eventType: "info", team: "India", homeScore: 52, overs: "10.4" },
      { minute: null, period: "1st Innings", message: "WICKET! Zampa traps Gill lbw for 38. Big breakthrough.", eventType: "wicket", actor: "Adam Zampa", team: "Australia", homeScore: 88, homeWickets: 2, overs: "18.2", metadata: { wicket: "Shubman Gill 38 (44)" } },
      { minute: null, period: "1st Innings", message: "Kohli brings up his 50 with a trademark cover drive.", eventType: "info", actor: "Virat Kohli", team: "India", homeScore: 118, overs: "24.5", tags: ["fifty"], metadata: { runs: 51 } },
      { minute: null, period: "1st Innings", message: "WICKET! Cummins has Kohli caught behind for 61.", eventType: "wicket", actor: "Pat Cummins", team: "Australia", homeScore: 141, homeWickets: 3, overs: "29.3", metadata: { wicket: "Virat Kohli 61 (72)" } },
      { minute: null, period: "1st Innings", message: "WICKET! Starc strikes again — Rahul edges to the keeper for 12.", eventType: "wicket", actor: "Mitchell Starc", team: "Australia", homeScore: 158, homeWickets: 4, overs: "33.1", metadata: { wicket: "KL Rahul 12 (21)" } },
      { minute: null, period: "1st Innings", message: "Drinks break. India 165/4 after 34 overs.", eventType: "timeout", team: "India", homeScore: 165, homeWickets: 4, overs: "34.0", tags: ["drinks"] },
      { minute: null, period: "1st Innings", message: "SIX! Hardik Pandya clears long-on to bring up the 180.", eventType: "info", actor: "Hardik Pandya", team: "India", homeScore: 181, homeWickets: 4, overs: "36.2", metadata: { runs: 6 } },
      { minute: null, period: "1st Innings", message: "WICKET! Cummins removes Pandya for 27 — India 191/5.", eventType: "wicket", actor: "Pat Cummins", team: "Australia", homeScore: 191, homeWickets: 5, overs: "38.4", metadata: { wicket: "Hardik Pandya 27 (18)" } },
      { minute: null, period: "Innings Break", message: "India finish on 247/6 from 50 overs. Australia need 248 to win.", eventType: "period", team: "India", homeScore: 247, homeWickets: 6, overs: "50.0", tags: ["innings-break"] },
      { minute: null, period: "2nd Innings", message: "Australia begin the chase. Target: 248 from 50 overs.", eventType: "start", team: "Australia", battingSide: "away", awayScore: 0, awayWickets: 0, overs: "0.0" },
      { minute: null, period: "2nd Innings", message: "FOUR! Head cuts Bumrah behind point to get off the mark.", eventType: "info", actor: "Travis Head", team: "Australia", battingSide: "away", awayScore: 14, awayWickets: 0, overs: "2.3", metadata: { runs: 4 } },
      { minute: null, period: "2nd Innings", message: "WICKET! Bumrah knocks over Head for 21.", eventType: "wicket", actor: "Jasprit Bumrah", team: "India", battingSide: "away", awayScore: 38, awayWickets: 1, overs: "6.4", metadata: { wicket: "Travis Head 21 (23)" } },
      { minute: null, period: "2nd Innings", message: "Fifty partnership for Australia — 78/1 after 14 overs.", eventType: "info", team: "Australia", battingSide: "away", awayScore: 78, awayWickets: 1, overs: "14.0" },
    ],
  },
  {
    sport: "cricket",
    homeTeam: "England",
    awayTeam: "South Africa",
    venue: "Lord's",
    competition: "Test Series",
    state: "live",
    startedMinutesAgo: 300,
    events: [
      { minute: null, period: "Day 3 · 2nd Innings", message: "Play resumes after lunch at Lord's. England 180/2, leading by 96.", eventType: "period", team: "England", homeScore: 180, homeWickets: 2, overs: "68.0" },
      { minute: null, period: "Day 3 · 2nd Innings", message: "FOUR! Root guides Rabada to third man.", eventType: "info", actor: "Joe Root", team: "England", homeScore: 214, homeWickets: 2, overs: "78.4", metadata: { runs: 4 } },
      { minute: null, period: "Day 3 · 2nd Innings", message: "WICKET! Rabada bowls Stokes through the gate for 32.", eventType: "wicket", actor: "Kagiso Rabada", team: "South Africa", homeScore: 238, homeWickets: 3, overs: "84.1", metadata: { wicket: "Ben Stokes 32 (45)" } },
      { minute: null, period: "Day 3 · 2nd Innings", message: "Century! Root reaches 100 with a nudge to leg.", eventType: "info", actor: "Joe Root", team: "England", homeScore: 287, homeWickets: 3, overs: "95.2", tags: ["century"], metadata: { runs: 100 } },
      { minute: null, period: "Day 3 · 2nd Innings", message: "WICKET! Jansen has Root caught at slip for 118. England 301/4.", eventType: "wicket", actor: "Marco Jansen", team: "South Africa", homeScore: 301, homeWickets: 4, overs: "99.3", metadata: { wicket: "Joe Root 118 (231)" } },
      { minute: null, period: "Day 3 · 2nd Innings", message: "Over rate warning issued to South Africa.", eventType: "info", team: "South Africa", tags: ["discipline"] },
    ],
  },
  {
    sport: "cricket",
    homeTeam: "Pakistan",
    awayTeam: "New Zealand",
    venue: "Gaddafi Stadium",
    competition: "T20 Series",
    state: "finished",
    durationMinutes: 180,
    finalScore: { home: 187, away: 172 },
    finalWickets: { home: 6, away: 8 },
    result: "Pakistan won by 15 runs",
    events: [
      { minute: null, period: "1st Innings", message: "Pakistan bat first after winning the toss.", eventType: "start" },
      { minute: null, period: "1st Innings", message: "SIX! Babar Azam clears the ropes at deep midwicket.", eventType: "info", actor: "Babar Azam", team: "Pakistan", homeScore: 34, homeWickets: 1, overs: "3.4", metadata: { runs: 6 } },
      { minute: null, period: "1st Innings", message: "WICKET! Sodhi has Rizwan stumped for 41. Pakistan 96/2.", eventType: "wicket", actor: "Ish Sodhi", team: "New Zealand", homeScore: 96, homeWickets: 2, overs: "11.3", metadata: { wicket: "Mohammad Rizwan 41 (29)" } },
      { minute: null, period: "1st Innings", message: "Pakistan finish on 187/6 from their 20 overs.", eventType: "end", team: "Pakistan", homeScore: 187, homeWickets: 6, overs: "20.0", metadata: { overs: 20 } },
      { minute: null, period: "2nd Innings", message: "New Zealand need 188 to win from 20 overs.", eventType: "period", team: "New Zealand", battingSide: "away", awayScore: 0, awayWickets: 0, overs: "0.0" },
      { minute: null, period: "2nd Innings", message: "WICKET! Afridi strikes with the first ball of the innings.", eventType: "wicket", actor: "Shaheen Afridi", team: "Pakistan", battingSide: "away", awayScore: 0, awayWickets: 1, overs: "0.1", metadata: { wicket: "Finn Allen 0 (1)" } },
      { minute: null, period: "2nd Innings", message: "FIFTY! Conway brings up a superb half-century.", eventType: "info", actor: "Devon Conway", team: "New Zealand", battingSide: "away", awayScore: 118, awayWickets: 3, overs: "13.2", metadata: { runs: 52 } },
      { minute: null, period: "2nd Innings", message: "New Zealand finish 15 short at 172/8. Pakistan win by 15 runs.", eventType: "end", team: "New Zealand", battingSide: "away", awayScore: 172, awayWickets: 8, overs: "20.0" },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Basketball                                                        */
  /* ---------------------------------------------------------------- */
  {
    sport: "basketball",
    homeTeam: "LA Lakers",
    awayTeam: "Boston Celtics",
    venue: "Crypto.com Arena",
    competition: "NBA Regular Season",
    state: "live",
    startedMinutesAgo: 38,
    events: [
      { minute: null, period: "Q1", message: "Tip-off in Los Angeles — Lakers control the opening possession.", eventType: "start", tags: ["tipoff"] },
      { minute: null, period: "Q1", message: "THREE! Curry... no, LeBron James opens with a three from the logo.", eventType: "three", actor: "LeBron James", team: "LA Lakers", homeScore: 3, awayScore: 0, metadata: { clock: "11:12" } },
      { minute: null, period: "Q1", message: "Tatum answers with a mid-range jumper.", eventType: "basket", actor: "Jayson Tatum", team: "Boston Celtics", homeScore: 3, awayScore: 2, metadata: { clock: "10:34" } },
      { minute: null, period: "Q1", message: "Basket + foul! Davis converts the and-one.", eventType: "basket", actor: "Anthony Davis", team: "LA Lakers", homeScore: 12, awayScore: 8, tags: ["and-one"], metadata: { clock: "07:58" } },
      { minute: null, period: "Q1", message: "Timeout Boston — Lakers on an 8-0 run.", eventType: "timeout", team: "Boston Celtics", homeScore: 18, awayScore: 8, metadata: { clock: "06:41", teamFouls: 3 } },
      { minute: null, period: "Q1", message: "End of the first quarter: Lakers 31-24 Celtics.", eventType: "period", homeScore: 31, awayScore: 24 },
      { minute: null, period: "Q2", message: "Reaves drills back-to-back threes off the bench.", eventType: "three", actor: "Austin Reaves", team: "LA Lakers", homeScore: 42, awayScore: 29, metadata: { clock: "09:12" } },
      { minute: null, period: "Q2", message: "Brown with the steal and the slam at the other end.", eventType: "basket", actor: "Jaylen Brown", team: "Boston Celtics", homeScore: 44, awayScore: 36, tags: ["steal", "dunk"] },
      { minute: null, period: "Q2", message: "Halftime: Lakers 58-52 Celtics.", eventType: "period", homeScore: 58, awayScore: 52 },
    ],
  },
  {
    sport: "basketball",
    homeTeam: "Golden State Warriors",
    awayTeam: "Denver Nuggets",
    venue: "Chase Center",
    competition: "NBA Regular Season",
    state: "scheduled",
    startsInMinutes: 90,
    events: [
      { minute: null, period: "Q1", message: "Tip-off at Chase Center.", eventType: "start" },
      { minute: null, period: "Q1", message: "THREE! Curry from way downtown.", eventType: "three", actor: "Stephen Curry", team: "Golden State Warriors", homeScore: 3, awayScore: 0, metadata: { clock: "11:02" } },
      { minute: null, period: "Q2", message: "Jokić posts a triple-double watch: 12 points, 8 rebounds, 7 assists.", eventType: "info", actor: "Nikola Jokić", team: "Denver Nuggets", metadata: { points: 12, rebounds: 8, assists: 7 } },
      { minute: null, period: "Q4", message: "Timeout Golden State with 2:14 left.", eventType: "timeout", team: "Golden State Warriors" },
      { minute: null, period: "Q4", message: "Final: Warriors 118-114 Nuggets.", eventType: "end" },
    ],
  },
  {
    sport: "basketball",
    homeTeam: "Milwaukee Bucks",
    awayTeam: "Miami Heat",
    venue: "Fiserv Forum",
    competition: "NBA Regular Season",
    state: "finished",
    durationMinutes: 150,
    finalScore: { home: 109, away: 103 },
    result: "Bucks win 109-103",
    events: [
      { minute: null, period: "Q1", message: "Tip-off in Milwaukee.", eventType: "start" },
      { minute: null, period: "Q1", message: "Antetokounmpo opens with a thunderous dunk.", eventType: "basket", actor: "Giannis Antetokounmpo", team: "Milwaukee Bucks", homeScore: 2, awayScore: 0 },
      { minute: null, period: "Q3", message: "THREE! Lillard extends the lead to 14.", eventType: "three", actor: "Damian Lillard", team: "Milwaukee Bucks", homeScore: 78, awayScore: 64 },
      { minute: null, period: "Q4", message: "Heat close the gap to four with a minute left.", eventType: "basket", actor: "Jimmy Butler", team: "Miami Heat", homeScore: 105, awayScore: 101 },
      { minute: null, period: "Q4", message: "Final: Bucks 109-103 Heat.", eventType: "end" },
    ],
  },
];
