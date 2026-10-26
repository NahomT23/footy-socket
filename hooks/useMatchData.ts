"use client";

/**
 * `useMatchData` — the single place where REST state and realtime state meet.
 *
 * Design rules:
 *  - REST is the source of truth for "what exists" (initial load, refetch).
 *  - Sockets are the source of truth for "what just changed" (score, feed).
 *  - Socket events are *merged*, never assumed to be a complete snapshot, so a
 *    missed packet is repaired by the next refetch instead of being lost.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import {
  SOCKET_EVENTS,
  type Commentary,
  type Match,
  type MatchStatus,
  type SubscriptionAckPayload,
} from "@/lib/types";
import { useSocket, type ConnectionStatus } from "./useSocket";

export const MATCHES_PER_PAGE = 6;

export type SportFilter = "all" | "football" | "cricket" | "basketball";

export interface ScorePulse {
  matchId: number;
  side: "home" | "away";
  /** Bumped on every change so a repeated pulse for the same side re-triggers. */
  nonce: number;
}

export interface UseMatchDataOptions {
  /** Matches rendered by the server component on first paint. */
  initialMatches?: Match[];
}

export interface UseMatchDataResult {
  matches: Match[];
  /** Paged + filtered view of `matches`, ready to render. */
  visibleMatches: Match[];
  commentary: Commentary[];
  tunedMatch: Match | null;
  tunedMatchId: number | null;
  subscribedMatchIds: number[];
  /** Server-confirmed number of sockets in the tuned fixture's room. */
  roomSubscribers: number;
  status: ConnectionStatus;
  isLoading: boolean;
  isLoadingFeed: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  filter: SportFilter;
  latestPulse: ScorePulse | null;
  refetch: () => Promise<void>;
  setPage: (page: number) => void;
  setFilter: (filter: SportFilter) => void;
  tuneIn: (matchId: number) => void;
  tuneOut: () => void;
}

const FEED_LIMIT = 60;
const SNAPSHOT_LIMIT = 100;

function matchesSort(a: Match, b: Match): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

/** Newest-first feed order: explicit `sequence` wins, `createdAt` breaks ties. */
function commentarySort(a: Commentary, b: Commentary): number {
  const seqA = a.sequence ?? -1;
  const seqB = b.sequence ?? -1;
  if (seqA !== seqB) return seqB - seqA;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export function useMatchData({ initialMatches = [] }: UseMatchDataOptions = {}): UseMatchDataResult {
  const [matches, setMatches] = useState<Match[]>(() => [...initialMatches].sort(matchesSort));
  const [commentaryByMatch, setCommentaryByMatch] = useState<Record<number, Commentary[]>>({});
  const [tunedMatchId, setTunedMatchId] = useState<number | null>(null);
  const [roomSubscribers, setRoomSubscribers] = useState(0);
  const [subscribedMatchIds, setSubscribedMatchIds] = useState<number[]>([]);
  const [page, setPageState] = useState(1);
  const [filter, setFilterState] = useState<SportFilter>("all");
  const [isLoading, setIsLoading] = useState(initialMatches.length === 0);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestPulse, setLatestPulse] = useState<ScorePulse | null>(null);

  /**
   * Lock guaranteeing exactly one startup snapshot fetch. Seeded from the
   * server-rendered snapshot when the page supplied one, so the socket
   * handshake does not immediately re-request identical data.
   */
  const initialSyncDoneRef = useRef(initialMatches.length > 0);

  /**
   * Armed whenever the socket drops. A reconnect then re-reads the snapshot,
   * because broadcasts sent while the transport was down were missed.
   */
  const needsResyncRef = useRef(false);


  // Refs give socket handlers synchronous access to the latest state without
  // making the handlers themselves unstable (which would re-bind listeners).
  const matchesRef = useRef<Match[]>(matches);
  const commentaryRef = useRef<Record<number, Commentary[]>>({});
  const knownIdsRef = useRef<Set<number>>(new Set(initialMatches.map((match) => match.id)));
  const tunedMatchIdRef = useRef<number | null>(null);
  const pulseNonceRef = useRef(0);

  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  useEffect(() => {
    commentaryRef.current = commentaryByMatch;
  }, [commentaryByMatch]);

  useEffect(() => {
    tunedMatchIdRef.current = tunedMatchId;
  }, [tunedMatchId]);

  /**
   * `refetch` must keep a **stable identity** for the lifetime of the hook:
   * the lifecycle effect depends on it, and an unstable callback would make
   * React tear down (and cancel) the pending fetch on the very next render.
   * All mutable inputs are therefore read through refs.
   */
  const refetch = useCallback(async () => {
    setError(null);
    try {
      const snapshot = await api.listMatches(SNAPSHOT_LIMIT);
      const sorted = [...snapshot].sort(matchesSort);
      for (const match of sorted) knownIdsRef.current.add(match.id);
      setMatches(sorted);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load matches");
    } finally {
      // Any completed fetch counts as an initial sync. This is the lock that
      // stops the socket handshake (which races with the mount fetch) from
      // issuing a second, redundant request for the same snapshot.
      initialSyncDoneRef.current = true;
      setIsLoading(false);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Realtime handlers (stable: they only read refs and set state)      */
  /* ---------------------------------------------------------------- */

  const handleMatchCreated = useCallback((match: Match) => {
    if (knownIdsRef.current.has(match.id)) return;
    knownIdsRef.current.add(match.id);
    setMatches((previous) => [match, ...previous].sort(matchesSort));
    // Surface the newest fixture instead of leaving the user on page 3.
    setPageState(1);
  }, []);

  const handleScore = useCallback(
    (payload: {
      matchId: number;
      homeScore: number;
      awayScore: number;
      homeWickets?: number;
      awayWickets?: number;
      homeOvers?: string | null;
      awayOvers?: string | null;
    }) => {
      const { matchId, homeScore, awayScore, homeWickets, awayWickets } = payload;

      const current = matchesRef.current.find((match) => match.id === matchId);
      if (!current) return;

      // Cricket can change just the wickets (a maiden wicket over), so compare
      // every dimension before deciding this is a no-op.
      const nextHomeWickets = homeWickets ?? current.homeWickets;
      const nextAwayWickets = awayWickets ?? current.awayWickets;
      const changed =
        current.homeScore !== homeScore ||
        current.awayScore !== awayScore ||
        current.homeWickets !== nextHomeWickets ||
        current.awayWickets !== nextAwayWickets;

      if (!changed) return;

      setMatches((previous) =>
        previous.map((match) =>
          match.id === matchId
            ? {
                ...match,
                homeScore,
                awayScore,
                homeWickets: nextHomeWickets,
                awayWickets: nextAwayWickets,
                homeOvers: payload.homeOvers ?? match.homeOvers,
                awayOvers: payload.awayOvers ?? match.awayOvers,
              }
            : match
        )
      );

      pulseNonceRef.current += 1;
      setLatestPulse({
        matchId,
        side:
          homeScore !== current.homeScore || nextHomeWickets !== current.homeWickets
            ? "home"
            : "away",
        nonce: pulseNonceRef.current,
      });
    },
    []
  );

  const handleCommentary = useCallback((entry: Commentary) => {
    setCommentaryByMatch((previous) => {
      const existing = previous[entry.matchId] ?? [];
      if (existing.some((item) => item.id === entry.id)) return previous;
      return {
        ...previous,
        [entry.matchId]: [entry, ...existing].sort(commentarySort).slice(0, FEED_LIMIT),
      };
    });
  }, []);

  const handleStatus = useCallback(
    ({
      matchId,
      status,
      homeScore,
      awayScore,
      homeWickets,
      awayWickets,
    }: {
      matchId: number;
      status: MatchStatus;
      homeScore: number;
      awayScore: number;
      homeWickets?: number;
      awayWickets?: number;
    }) => {
      setMatches((previous) =>
        previous.map((match) =>
          match.id === matchId
            ? {
                ...match,
                status,
                homeScore,
                awayScore,
                homeWickets: homeWickets ?? match.homeWickets,
                awayWickets: awayWickets ?? match.awayWickets,
              }
            : match
        )
      );

      // The server detaches the room when a fixture finishes; mirror that here
      // so the dashboard stops claiming it is still subscribed.
      if (status === "finished") {
        setSubscribedMatchIds((previous) => previous.filter((id) => id !== matchId));
        setTunedMatchId((current) => (current === matchId ? null : current));
      }
    },
    []
  );

  const handleRateLimited = useCallback((payload: { message: string }) => {
    setError(payload.message);
  }, []);

  const { status, joinMatch, leaveMatch } = useSocket({
    handlers: {
      [SOCKET_EVENTS.matchCreated]: handleMatchCreated,
      [SOCKET_EVENTS.matchScore]: handleScore,
      [SOCKET_EVENTS.matchCommentary]: handleCommentary,
      [SOCKET_EVENTS.matchStatus]: handleStatus,
      [SOCKET_EVENTS.rateLimited]: handleRateLimited,
    },
  });

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Everything that pulls the authoritative snapshot lives in this one effect:
   *
   *   - mount with an empty grid     -> fetch, because the server had nothing.
   *   - mount with a server snapshot -> trust it; it is one round trip old.
   *   - reconnect after an outage    -> fetch, because broadcasts sent while
   *                                     the socket was down were missed, so the
   *                                     merged state is incomplete by definition.
   *
   * `initialSyncDoneRef` stops the *initial* handshake from duplicating the
   * mount fetch, while `needsResyncRef` is armed by an actual drop — which is
   * what distinguishes "we just connected" from "we lost and regained the
   * socket".
   */
  // Arm the resync flag only on a *transition* away from connected. Merely
  // mounting in a non-connected state (the normal case while the handshake is
  // still in flight) must not arm it, or the first connect would refetch a
  // snapshot the server has just rendered.
  const previousStatusRef = useRef<ConnectionStatus>("connecting");

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;

    if (previous === "connected" && status !== "connected") {
      needsResyncRef.current = true;
    }
  }, [status]);

  useEffect(() => {
    const connected = status === "connected";
    // No snapshot yet and the socket is still handshaking: fetch right away.
    const needsInitialFetch = !connected && !initialSyncDoneRef.current;
    // `needsResyncRef` covers a lost-and-regained socket; the second clause
    // covers the case where the socket connected before the mount fetch ever
    // ran (no server snapshot), which must still populate the grid.
    const needsResync = connected && (needsResyncRef.current || !initialSyncDoneRef.current);

    if (!needsInitialFetch && !needsResync) return;
    needsResyncRef.current = false;

    // Deferred so the first paint is never blocked by a cascading render
    // (and to satisfy the React 19 "no setState directly in an effect" rule).
    const timer = window.setTimeout(() => void refetch(), 0);
    return () => window.clearTimeout(timer);
  }, [status, refetch]);

  /** Loads a fixture's feed once from REST; socket entries then take over. */
  const ensureCommentary = useCallback(async (matchId: number) => {
    if (commentaryRef.current[matchId]) return;
    setIsLoadingFeed(true);
    try {
      const entries = await api.listCommentary(matchId, FEED_LIMIT);
      setCommentaryByMatch((previous) => {
        const merged = [...(previous[matchId] ?? [])];
        for (const entry of entries) {
          if (!merged.some((item) => item.id === entry.id)) merged.push(entry);
        }
        return { ...previous, [matchId]: merged.sort(commentarySort).slice(0, FEED_LIMIT) };
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load commentary");
    } finally {
      setIsLoadingFeed(false);
    }
  }, []);

  /** Applies a server ack, ignoring stale acks from a room we already left. */
  const applyAck = useCallback((ack: SubscriptionAckPayload) => {
    if (ack.matchId !== tunedMatchIdRef.current) return;
    setRoomSubscribers(ack.subscribers);
  }, []);

  /**
   * Re-subscribe after a reconnect.
   *
   * A dropped transport destroys the server-side socket and every room it was
   * in, so the client must re-join the fixture the user is still watching —
   * otherwise the feed would look connected but stay frozen.
   */
  useEffect(() => {
    const tuned = tunedMatchIdRef.current;
    if (status !== "connected" || tuned === null) return;

    joinMatch(tuned);
    void ensureCommentary(tuned);
  }, [status, joinMatch, ensureCommentary]);

  const tuneIn = useCallback(
    (matchId: number) => {
      const previous = tunedMatchIdRef.current;
      if (previous === matchId) return;

      if (previous !== null) {
        leaveMatch(previous);
        setSubscribedMatchIds((ids) => ids.filter((id) => id !== previous));
      }

      tunedMatchIdRef.current = matchId;
      setTunedMatchId(matchId);
      joinMatch(matchId, applyAck);
      setSubscribedMatchIds((ids) => (ids.includes(matchId) ? ids : [...ids, matchId]));
      setRoomSubscribers(0);
      setError(null);
      void ensureCommentary(matchId);
    },
    [applyAck, ensureCommentary, joinMatch, leaveMatch]
  );

  const tuneOut = useCallback(() => {
    const current = tunedMatchIdRef.current;
    if (current === null) return;
    leaveMatch(current);
    setSubscribedMatchIds((ids) => ids.filter((id) => id !== current));
    tunedMatchIdRef.current = null;
    setTunedMatchId(null);
    setRoomSubscribers(0);
  }, [leaveMatch]);

  /* ---------------------------------------------------------------- */
  /* Derived view                                                      */
  /* ---------------------------------------------------------------- */

  const filtered = useMemo(
    () => (filter === "all" ? matches : matches.filter((match) => match.sport === filter)),
    [matches, filter]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / MATCHES_PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const visibleMatches = useMemo(
    () => filtered.slice((safePage - 1) * MATCHES_PER_PAGE, safePage * MATCHES_PER_PAGE),
    [filtered, safePage]
  );

  const tunedMatch = useMemo(
    () => matches.find((match) => match.id === tunedMatchId) ?? null,
    [matches, tunedMatchId]
  );

  const commentary = useMemo(
    () => (tunedMatchId === null ? [] : commentaryByMatch[tunedMatchId] ?? []),
    [commentaryByMatch, tunedMatchId]
  );

  const setPage = useCallback((next: number) => {
    setPageState(Math.max(1, next));
  }, []);

  const setFilter = useCallback((next: SportFilter) => {
    setFilterState(next);
    setPageState(1);
  }, []);

  return {
    matches,
    visibleMatches,
    commentary,
    tunedMatch,
    tunedMatchId,
    subscribedMatchIds,
    roomSubscribers,
    status,
    isLoading,
    isLoadingFeed,
    error,
    page: safePage,
    totalPages,
    filter,
    latestPulse,
    refetch,
    setPage,
    setFilter,
    tuneIn,
    tuneOut,
  };
}
