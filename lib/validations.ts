/**
 * Shared Zod validation schemas.
 *
 * These are imported by BOTH the REST Route Handlers and the Socket.IO layer,
 * which is the whole point: a payload that the HTTP API accepts can never be
 * rejected by the socket API for a different reason.
 */
import { z } from "zod";

import { EVENT_TYPES, MATCH_STATUSES, SPORTS } from "./types";

/** Path/query parameters arrive as strings; coerce then constrain. */
export const idParamSchema = z.coerce
  .number()
  .int("Match id must be an integer")
  .positive("Match id must be positive")
  .max(2_147_483_647, "Match id is out of range");

export const limitQuerySchema = z.coerce
  .number()
  .int()
  .min(1, "limit must be at least 1")
  .max(100, "limit cannot exceed 100")
  .default(50);

export const sportSchema = z.enum(SPORTS);

export const matchStatusSchema = z.enum(MATCH_STATUSES);

const isoDateString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Must be a valid ISO-8601 date string",
  });

export const createMatchSchema = z
  .object({
    sport: sportSchema,
    homeTeam: z.string().trim().min(1, "homeTeam is required").max(80),
    awayTeam: z.string().trim().min(1, "awayTeam is required").max(80),
    startTime: isoDateString,
    endTime: isoDateString,
    homeScore: z.number().int().min(0).max(999).default(0),
    awayScore: z.number().int().min(0).max(999).default(0),
    /** Cricket wickets, capped at 10 per innings. Ignored for other sports. */
    homeWickets: z.number().int().min(0).max(10).default(0),
    awayWickets: z.number().int().min(0).max(10).default(0),
    homeInnings: z.number().int().min(0).max(4).default(0),
    awayInnings: z.number().int().min(0).max(4).default(0),
    /** Final outcome; only meaningful once the fixture has concluded. */
    result: z.string().trim().max(120).nullish(),
  })
  .refine((value) => value.homeTeam !== value.awayTeam, {
    message: "homeTeam and awayTeam must differ",
    path: ["awayTeam"],
  })
  .refine((value) => Date.parse(value.endTime) > Date.parse(value.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });

export type CreateMatchInput = z.input<typeof createMatchSchema>;
export type CreateMatchData = z.output<typeof createMatchSchema>;

export const updateScoreSchema = z.object({
  homeScore: z
    .number({ message: "homeScore must be a number" })
    .int("homeScore must be an integer")
    .min(0, "homeScore cannot be negative")
    .max(999, "homeScore is out of range"),
  awayScore: z
    .number({ message: "awayScore must be a number" })
    .int("awayScore must be an integer")
    .min(0, "awayScore cannot be negative")
    .max(999, "awayScore is out of range"),
  // Optional so existing football/basketball callers stay unchanged. For
  // cricket the simulator always sends them, which is what makes the scoreboard
  // read `runs/wickets` instead of a bare, meaningless run count.
  homeWickets: z.number().int().min(0).max(10).optional(),
  awayWickets: z.number().int().min(0).max(10).optional(),
  homeInnings: z.number().int().min(0).max(4).optional(),
  awayInnings: z.number().int().min(0).max(4).optional(),
  homeOvers: z.string().trim().max(12).nullish(),
  awayOvers: z.string().trim().max(12).nullish(),
  result: z.string().trim().max(120).nullish(),
});

export type UpdateScoreInput = z.infer<typeof updateScoreSchema>;

export const createCommentarySchema = z.object({
  minute: z.number().int().min(0).max(1_440).nullish(),
  sequence: z.number().int().min(0).max(100_000).nullish(),
  period: z.string().trim().max(40).nullish(),
  eventType: z.enum(EVENT_TYPES).nullish(),
  actor: z.string().trim().max(80).nullish(),
  team: z.string().trim().max(80).nullish(),
  message: z.string().trim().min(1, "message is required").max(600),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

export type CreateCommentaryInput = z.input<typeof createCommentarySchema>;
export type CreateCommentaryData = z.output<typeof createCommentarySchema>;

/** Client -> server socket payloads. */
export const joinMatchSchema = z.object({ matchId: idParamSchema });
export type JoinMatchInput = z.infer<typeof joinMatchSchema>;

/** Flattens a ZodError into the `issues` array used by `ApiFailure`. */
export function toIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}
