/**
 * Shared domain types for Sportz.
 *
 * These are the single source of truth for the shape of data that crosses a
 * boundary: PostgreSQL -> Prisma -> API Route Handler -> Socket.IO -> React.
 *
 * Everything here is JSON-serialisable on purpose: a `Match` travels over HTTP
 * and over a WebSocket, so it must never contain `Date` objects or Prisma
 * internals. Dates are ISO-8601 strings (see `lib/serializers.ts`).
 */

export const SPORTS = ["football", "cricket", "basketball"] as const;
export type Sport = (typeof SPORTS)[number];

export const MATCH_STATUSES = ["scheduled", "live", "finished"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * Commentary categories. Kept as a closed set so the UI can render a badge
 * colour for every value the server can ever send, and so Zod rejects typos
 * from the simulator before they reach PostgreSQL.
 */
export const EVENT_TYPES = [
  "start",
  "goal",
  "card",
  "basket",
  "three",
  "wicket",
  "foul",
  "timeout",
  "substitution",
  "stoppage",
  "period",
  "end",
  "info",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A fixture as serialised for clients. */
export interface Match {
  id: number;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  /** ISO-8601 UTC timestamp. */
  startTime: string;
  /** ISO-8601 UTC timestamp. */
  endTime: string;
  homeScore: number;
  awayScore: number;
  /**
   * Cricket only: wickets lost. A cricket score is only meaningful as
   * `runs/wickets`, so these travel alongside the runs everywhere. Always 0 for
   * football and basketball.
   */
  homeWickets: number;
  awayWickets: number;
  /** Cricket only: completed innings per side (2+ means a multi-innings match). */
  homeInnings: number;
  awayInnings: number;
  /** Cricket only: overs completed, e.g. `"33.1"`. Null before a side bats. */
  homeOvers: string | null;
  awayOvers: string | null;
  /** Written when the fixture concludes, e.g. "India won by 169 runs". */
  result: string | null;
  /** Competition/league display name ("NBA", "English Premier League"). */
  competition?: string | null;
  createdAt: string;
}

/** One play-by-play entry as serialised for clients. */
export interface Commentary {
  id: number;
  matchId: number;
  minute: number | null;
  sequence: number | null;
  period: string | null;
  eventType: string | null;
  actor: string | null;
  team: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  tags: string[];
  createdAt: string;
}

/** Envelope used by every REST endpoint so clients parse one shape only. */
export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: {
    /** Machine-readable code, e.g. `VALIDATION_ERROR`. */
    code: string;
    /** Human-readable summary. */
    message: string;
    /** Field-level issues from Zod, when applicable. */
    issues?: { path: string; message: string }[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * Socket.IO event contract.
 *
 * `SOCKET_EVENTS` is consumed by both the custom server (`server.mjs` cannot
 * import TypeScript, so it mirrors these literals) and the React client, which
 * keeps client/server drift visible in one file.
 */
export const SOCKET_EVENTS = {
  /** client -> server: subscribe to a fixture room */
  joinMatch: "join:match",
  /** client -> server: unsubscribe from a fixture room */
  leaveMatch: "leave:match",
  /** server -> all clients: a brand-new fixture was scheduled */
  matchCreated: "match:created",
  /** server -> match room: score change */
  matchScore: "match:score",
  /** server -> match room: new play-by-play entry */
  matchCommentary: "match:commentary",
  /** server -> all clients: lifecycle transition (scheduled/live/finished) */
  matchStatus: "match:status",
  /** server -> client: acknowledgement of a room join/leave */
  subscriptionAck: "subscription:ack",
  /** server -> client: this connection exceeded its rate limit */
  rateLimited: "rate:limited",
} as const;

export interface JoinMatchPayload {
  matchId: number;
}

export interface MatchScorePayload {
  matchId: number;
  homeScore: number;
  awayScore: number;
  /** Cricket wickets lost; omitted/0 for other sports. */
  homeWickets?: number;
  awayWickets?: number;
  /** Cricket overs completed, e.g. `"31.4"`, for display context. */
  homeOvers?: string | null;
  awayOvers?: string | null;
}

export interface MatchStatusPayload {
  matchId: number;
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
  homeWickets: number;
  awayWickets: number;
}

export interface SubscriptionAckPayload {
  matchId: number;
  room: string;
  joined: boolean;
  /** Current number of sockets in the room after this operation. */
  subscribers: number;
}

export interface RateLimitedPayload {
  event: string;
  message: string;
  retryAfterMs: number;
}

/**
 * Just the server -> client events. The client subscribes to this list (and
 * only this list) so a room acknowledgement or rate-limit notice can never be
 * mistaken for a domain event.
 */
export const SERVER_TO_CLIENT_EVENTS = [
  SOCKET_EVENTS.matchCreated,
  SOCKET_EVENTS.matchScore,
  SOCKET_EVENTS.matchCommentary,
  SOCKET_EVENTS.matchStatus,
  SOCKET_EVENTS.subscriptionAck,
  SOCKET_EVENTS.rateLimited,
] as const;

/** Server -> client events, used to type `socket.on(...)` on the client. */
export interface ServerToClientEvents {
  [SOCKET_EVENTS.matchCreated]: (match: Match) => void;
  [SOCKET_EVENTS.matchScore]: (payload: MatchScorePayload) => void;
  [SOCKET_EVENTS.matchCommentary]: (commentary: Commentary) => void;
  [SOCKET_EVENTS.matchStatus]: (payload: MatchStatusPayload) => void;
  [SOCKET_EVENTS.subscriptionAck]: (payload: SubscriptionAckPayload) => void;
  [SOCKET_EVENTS.rateLimited]: (payload: RateLimitedPayload) => void;
}

/** Client -> server events, used to type `socket.emit(...)` on the client. */
export interface ClientToServerEvents {
  [SOCKET_EVENTS.joinMatch]: (
    payload: JoinMatchPayload,
    ack?: (response: SubscriptionAckPayload) => void
  ) => void;
  [SOCKET_EVENTS.leaveMatch]: (
    payload: JoinMatchPayload,
    ack?: (response: SubscriptionAckPayload) => void
  ) => void;
}

/** Builds the Socket.IO room name for a fixture. One definition, everywhere. */
export function matchRoom(matchId: number | string): string {
  return `match:${matchId}`;
}

export function isSport(value: string): value is Sport {
  return (SPORTS as readonly string[]).includes(value);
}

/**
 * Formats a score for display. Cricket shows `runs/wickets`; other sports show
 * the bare number, because "170/0" would be nonsense for a football score.
 */
export function formatScore(
  sport: string,
  score: number,
  wickets: number
): string {
  return sport === "cricket" ? `${score}/${wickets}` : String(score);
}
