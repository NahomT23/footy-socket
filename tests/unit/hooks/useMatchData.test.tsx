/**
 * @vitest-environment jsdom
 *
 * `useMatchData` is where REST snapshots and realtime broadcasts are merged,
 * so it is tested against a fake API and a fake socket. The socket is faked at
 * the `useSocket` boundary, which also proves the hook only depends on that
 * narrow interface.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handlers = Record<string, ((payload: never) => void) | undefined>;

const state = vi.hoisted(() => ({
  handlers: {} as Handlers,
  api: {
    listMatches: vi.fn(),
    listCommentary: vi.fn(),
    getMatch: vi.fn(),
  },
  socketResult: {
    status: "connected" as const,
    socketId: "fake-socket",
    transport: "websocket",
    attempts: 0,
    joinMatch: vi.fn(),
    leaveMatch: vi.fn(),
  },
}));

vi.mock("@/hooks/useSocket", () => ({
  useSocket: (options: { handlers?: Handlers }) => {
    // Capture the latest handlers without changing the identity of the
    // returned object: the real hook returns stable callbacks, and an unstable
    // stub would make the hook's effects re-run for the wrong reason.
    state.handlers = options?.handlers ?? {};
    return state.socketResult;
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: state.api };
});

const { MATCHES_PER_PAGE, useMatchData } = await import("@/hooks/useMatchData");
const { SOCKET_EVENTS } = await import("@/lib/types");
type Match = import("@/lib/types").Match;
type Commentary = import("@/lib/types").Commentary;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 1,
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "live",
    startTime: new Date(Date.now() - 60_000).toISOString(),
    endTime: new Date(Date.now() + 3_600_000).toISOString(),
    homeScore: 0,
    awayScore: 0,
    homeWickets: 0,
    awayWickets: 0,
    homeInnings: 0,
    awayInnings: 0,
    homeOvers: null,
    awayOvers: null,
    result: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function commentary(overrides: Partial<Commentary> = {}): Commentary {
  return {
    id: 1,
    matchId: 1,
    minute: 12,
    sequence: 1,
    period: "First Half",
    eventType: "goal",
    actor: null,
    team: null,
    message: "Event",
    metadata: null,
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Tunes in and flushes the async commentary fetch.
 *
 * `tuneIn` kicks off a REST request whose resolution updates state, so tests
 * must await it inside `act` or React reports an unwrapped update.
 */
async function tuneInAndSettle(
  result: { current: { tuneIn: (matchId: number) => void } },
  matchId: number
) {
  await act(async () => {
    result.current.tuneIn(matchId);
  });
}

/** Emits a server -> client event through the captured handler map. */
function emit(event: string, payload: unknown) {
  act(() => {
    state.handlers[event]?.(payload as never);
  });
}

beforeEach(() => {
  state.handlers = {};
  state.socketResult.joinMatch.mockClear();
  state.socketResult.leaveMatch.mockClear();
  state.api.listMatches.mockReset().mockResolvedValue([]);
  state.api.listCommentary.mockReset().mockResolvedValue([]);
});

/* ------------------------------------------------------------------ */

describe("useMatchData — hydration", () => {
  it("uses the server snapshot without refetching", async () => {
    const initial = [match({ id: 1 }), match({ id: 2 })];
    const { result } = renderHook(() => useMatchData({ initialMatches: initial }));

    expect(result.current.matches).toHaveLength(2);
    expect(result.current.isLoading).toBe(false);

    // No REST call is needed when the server already rendered data.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state.api.listMatches).not.toHaveBeenCalled();
  });

  it("fetches from REST when the server snapshot is empty", async () => {
    state.api.listMatches.mockResolvedValue([match({ id: 5, homeTeam: "Fetched" })]);

    const { result } = renderHook(() => useMatchData({ initialMatches: [] }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.matches[0].homeTeam).toBe("Fetched");
  });

  it("orders fixtures newest first", async () => {
    const older = match({ id: 1, createdAt: new Date(Date.now() - 10_000).toISOString() });
    const newer = match({ id: 2, createdAt: new Date().toISOString() });

    const { result } = renderHook(() => useMatchData({ initialMatches: [older, newer] }));
    expect(result.current.matches.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it("surfaces an API failure as an error message", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    state.api.listMatches.mockRejectedValue(new ApiError("Network unavailable", "NETWORK_ERROR", 0));

    const { result } = renderHook(() => useMatchData({ initialMatches: [] }));
    await waitFor(() => expect(result.current.error).toBe("Network unavailable"));
  });
});

describe("useMatchData — realtime merging", () => {
  it("prepends a newly scheduled fixture and resets to page 1", async () => {
    const initial = Array.from({ length: 8 }, (_, index) =>
      match({ id: index + 1, createdAt: new Date(Date.now() - index * 1_000).toISOString() })
    );

    const { result } = renderHook(() => useMatchData({ initialMatches: initial }));
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    emit(SOCKET_EVENTS.matchCreated, match({ id: 99, homeTeam: "Brand New" }));

    await waitFor(() => expect(result.current.matches[0].homeTeam).toBe("Brand New"));
    expect(result.current.page).toBe(1);
  });

  it("ignores a duplicate match:created broadcast", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    emit(SOCKET_EVENTS.matchCreated, match({ id: 1 }));
    emit(SOCKET_EVENTS.matchCreated, match({ id: 1 }));

    expect(result.current.matches).toHaveLength(1);
  });

  it("applies score broadcasts and reports which side scored", async () => {
    const { result } = renderHook(() =>
      useMatchData({ initialMatches: [match({ id: 1, homeScore: 0, awayScore: 0 })] })
    );

    emit(SOCKET_EVENTS.matchScore, { matchId: 1, homeScore: 1, awayScore: 0 });

    await waitFor(() => expect(result.current.matches[0].homeScore).toBe(1));
    expect(result.current.latestPulse).toMatchObject({ matchId: 1, side: "home" });

    emit(SOCKET_EVENTS.matchScore, { matchId: 1, homeScore: 1, awayScore: 1 });
    expect(result.current.latestPulse).toMatchObject({ matchId: 1, side: "away" });
    // A new pulse always carries a fresh nonce so animations restart.
    expect(result.current.latestPulse?.nonce).toBeGreaterThan(1);
  });

  it("ignores a score broadcast for an unknown fixture", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    emit(SOCKET_EVENTS.matchScore, { matchId: 42, homeScore: 9, awayScore: 9 });

    expect(result.current.matches[0].homeScore).toBe(0);
    expect(result.current.latestPulse).toBeNull();
  });

  it("does not pulse when a score broadcast repeats the current value", () => {
    const { result } = renderHook(() =>
      useMatchData({ initialMatches: [match({ id: 1, homeScore: 3, awayScore: 1 })] })
    );

    emit(SOCKET_EVENTS.matchScore, { matchId: 1, homeScore: 3, awayScore: 1 });

    expect(result.current.latestPulse).toBeNull();
  });

  it("merges commentary broadcasts without duplicating ids", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    await tuneInAndSettle(result, 1);
    await waitFor(() => expect(state.api.listCommentary).toHaveBeenCalledWith(1, 60));

    emit(SOCKET_EVENTS.matchCommentary, commentary({ id: 10, matchId: 1, sequence: 2 }));
    emit(SOCKET_EVENTS.matchCommentary, commentary({ id: 10, matchId: 1, sequence: 2 }));
    emit(SOCKET_EVENTS.matchCommentary, commentary({ id: 11, matchId: 1, sequence: 3 }));

    await waitFor(() => expect(result.current.commentary).toHaveLength(2));
    // Newest (highest sequence) first.
    expect(result.current.commentary[0].id).toBe(11);
  });

  it("keeps commentary for other fixtures out of the tuned feed", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    await tuneInAndSettle(result, 1);
    emit(SOCKET_EVENTS.matchCommentary, commentary({ id: 5, matchId: 2 }));

    await waitFor(() => expect(result.current.tunedMatchId).toBe(1));
    expect(result.current.commentary).toHaveLength(0);
  });

  it("updates status broadcasts and detaches a finished fixture", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1, status: "live" })] }));

    await tuneInAndSettle(result, 1);
    expect(result.current.subscribedMatchIds).toEqual([1]);

    emit(SOCKET_EVENTS.matchStatus, { matchId: 1, status: "finished", homeScore: 4, awayScore: 2 });

    await waitFor(() => expect(result.current.matches[0].status).toBe("finished"));
    expect(result.current.matches[0].homeScore).toBe(4);
    // The server dropped the room, so the client mirrors that.
    expect(result.current.subscribedMatchIds).toEqual([]);
    expect(result.current.tunedMatchId).toBeNull();
  });

  it("surfaces a server rate-limit notice as an error", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    emit(SOCKET_EVENTS.rateLimited, { event: "join:match", message: "Slow down", retryAfterMs: 1_000 });

    await waitFor(() => expect(result.current.error).toBe("Slow down"));
  });
});

describe("useMatchData — subscriptions", () => {
  it("joins the room and loads the feed on tune in", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 7 })] }));

    await tuneInAndSettle(result, 7);

    expect(state.socketResult.joinMatch).toHaveBeenCalledWith(7, expect.any(Function));
    await waitFor(() => expect(state.api.listCommentary).toHaveBeenCalled());
    expect(result.current.tunedMatchId).toBe(7);
    expect(result.current.subscribedMatchIds).toEqual([7]);
    expect(result.current.tunedMatch?.id).toBe(7);
  });

  it("leaves the previous room when switching fixtures", async () => {
    const { result } = renderHook(() =>
      useMatchData({ initialMatches: [match({ id: 1 }), match({ id: 2 })] })
    );

    await tuneInAndSettle(result, 1);
    await tuneInAndSettle(result, 2);

    expect(state.socketResult.leaveMatch).toHaveBeenCalledWith(1);
    expect(result.current.subscribedMatchIds).toEqual([2]);
  });

  it("is idempotent when tuning into the same fixture twice", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));

    await tuneInAndSettle(result, 1);
    await tuneInAndSettle(result, 1);

    expect(state.socketResult.joinMatch).toHaveBeenCalledTimes(1);
  });

  it("leaves the room on tune out and clears the feed selection", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 3 })] }));

    await tuneInAndSettle(result, 3);
    await act(async () => {
      result.current.tuneOut();
    });

    expect(state.socketResult.leaveMatch).toHaveBeenCalledWith(3);
    expect(result.current.tunedMatchId).toBeNull();
    expect(result.current.subscribedMatchIds).toEqual([]);
    expect(result.current.tunedMatch).toBeNull();
  });

  it("does nothing on tune out when no fixture is tuned", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1 })] }));
    act(() => result.current.tuneOut());
    expect(state.socketResult.leaveMatch).not.toHaveBeenCalled();
  });
});

describe("useMatchData — filtering and pagination", () => {
  const many = [
    ...Array.from({ length: 4 }, (_, index) =>
      match({ id: index + 1, sport: "football", createdAt: new Date(Date.now() - index * 1_000).toISOString() })
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      match({ id: index + 10, sport: "cricket", createdAt: new Date(Date.now() - index * 1_000).toISOString() })
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      match({ id: index + 20, sport: "basketball", createdAt: new Date(Date.now() - index * 1_000).toISOString() })
    ),
  ];

  it("shows at most MATCHES_PER_PAGE fixtures on a page", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: many }));
    expect(result.current.visibleMatches).toHaveLength(MATCHES_PER_PAGE);
    expect(result.current.totalPages).toBe(2);
  });

  it("returns the remainder on the last page", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: many }));
    act(() => result.current.setPage(2));
    expect(result.current.visibleMatches).toHaveLength(many.length - MATCHES_PER_PAGE);
  });

  it("filters by sport and resets to the first page", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: many }));
    act(() => result.current.setPage(2));
    act(() => result.current.setFilter("cricket"));

    expect(result.current.page).toBe(1);
    expect(result.current.visibleMatches).toHaveLength(3);
    expect(result.current.visibleMatches.every((entry) => entry.sport === "cricket")).toBe(true);
  });

  it("never lets the page exceed the available pages", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: many }));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(result.current.totalPages);
  });

  it("clamps a page below 1", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: many }));
    act(() => result.current.setPage(-5));
    expect(result.current.page).toBe(1);
  });

  it("reports at least one page when there are no fixtures", () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [] }));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.visibleMatches).toHaveLength(0);
  });
});

describe("useMatchData — re-sync", () => {
  it("replaces the snapshot when refetch resolves", async () => {
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1, homeTeam: "Old" })] }));

    state.api.listMatches.mockResolvedValue([match({ id: 2, homeTeam: "Fresh" })]);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].homeTeam).toBe("Fresh");
  });

  it("keeps the previous snapshot when refetch fails", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    const { result } = renderHook(() => useMatchData({ initialMatches: [match({ id: 1, homeTeam: "Kept" })] }));

    state.api.listMatches.mockRejectedValue(new ApiError("boom", "INTERNAL_ERROR", 500));
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.matches[0].homeTeam).toBe("Kept");
    expect(result.current.error).toBe("boom");
  });
});
