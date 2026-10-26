/**
 * Typed REST client for the Sportz API.
 *
 * Every helper returns the unwrapped payload or throws an `ApiError`, so hooks
 * and components never have to branch on HTTP status codes by hand.
 */
import type { ApiFailure, ApiSuccess, Commentary, Match } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "INTERNAL_ERROR", status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      // Live sports data must never be served from the HTTP cache.
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network unavailable — check your connection", "NETWORK_ERROR", 0);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const failure = body as ApiFailure | null;
    throw new ApiError(
      failure?.error?.message ?? `Request failed with status ${response.status}`,
      failure?.error?.code ?? "INTERNAL_ERROR",
      response.status
    );
  }

  return (body as ApiSuccess<T>).data;
}

export const api = {
  listMatches(limit = 100, signal?: AbortSignal): Promise<Match[]> {
    return request<Match[]>(`/api/matches?limit=${limit}`, { signal });
  },

  getMatch(id: number, signal?: AbortSignal): Promise<Match> {
    return request<Match>(`/api/matches/${id}`, { signal });
  },

  listCommentary(matchId: number, limit = 50, signal?: AbortSignal): Promise<Commentary[]> {
    return request<Commentary[]>(`/api/matches/${matchId}/commentary?limit=${limit}`, { signal });
  },
};
