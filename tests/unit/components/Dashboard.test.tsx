/**
 * @vitest-environment jsdom
 *
 * `Dashboard` is the composition root: it wires the data hook to the grid, the
 * feed, the toasts and the empty/loading states. The data hook is mocked so
 * each rendering branch can be exercised deterministically.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/Dashboard";
import type { Commentary, Match } from "@/lib/types";

type HookState = ReturnType<typeof import("@/hooks/useMatchData").useMatchData>;

const hook = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useMatchData", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useMatchData")>("@/hooks/useMatchData");
  return {
    ...actual,
    useMatchData: () => hook.state as unknown as HookState,
  };
});

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 1,
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "live",
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 3_600_000).toISOString(),
    homeScore: 2,
    awayScore: 1,
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
    actor: "Saka",
    team: "Arsenal",
    message: "GOAL!",
    metadata: null,
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Sensible defaults; individual tests override only what they assert. */
function setHook(overrides: Partial<Record<string, unknown>> = {}) {
  hook.state = {
    matches: [],
    visibleMatches: [],
    commentary: [],
    tunedMatch: null,
    tunedMatchId: null,
    subscribedMatchIds: [],
    roomSubscribers: 0,
    status: "connected",
    isLoading: false,
    isLoadingFeed: false,
    error: null,
    page: 1,
    totalPages: 1,
    filter: "all",
    latestPulse: null,
    overs: {},
    refetch: vi.fn(),
    setPage: vi.fn(),
    setFilter: vi.fn(),
    tuneIn: vi.fn(),
    tuneOut: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  setHook();
});

describe("Dashboard — states", () => {
  it("renders the header, brand and connection pill", () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/sportz/i);
    expect(screen.getByText(/real-time sports coverage/i)).toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  });

  it("shows a loading skeleton grid while the first fetch is in flight", () => {
    setHook({ isLoading: true, visibleMatches: [] });
    const { container } = render(<Dashboard />);

    expect(screen.getByLabelText(/loading matches/i)).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("invites the user to seed when there are no fixtures at all", () => {
    render(<Dashboard />);

    expect(screen.getByText(/no fixtures yet/i)).toBeInTheDocument();
    expect(screen.getByText(/npm run seed/i)).toBeInTheDocument();
  });

  it("renders a card per visible fixture", () => {
    setHook({
      matches: [match({ id: 1 }), match({ id: 2, homeTeam: "Liverpool", awayTeam: "City" })],
      visibleMatches: [match({ id: 1 }), match({ id: 2, homeTeam: "Liverpool", awayTeam: "City" })],
      totalPages: 1,
    });

    render(<Dashboard />);

    expect(screen.getByText("Arsenal")).toBeInTheDocument();
    expect(screen.getByText("Liverpool")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("summarises fixture counts in the stat strip", () => {
    const live = match({ id: 1, status: "live" });
    const scheduled = match({ id: 2, status: "scheduled", homeTeam: "B", awayTeam: "C" });
    setHook({ matches: [live, scheduled], visibleMatches: [live, scheduled] });

    render(<Dashboard />);

    expect(screen.getByText("Live now").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Fixtures").nextElementSibling).toHaveTextContent("2");
  });

  it("counts fixtures per sport for the filter bar", () => {
    const football = match({ id: 1, sport: "football" });
    const cricket = match({ id: 2, sport: "cricket", homeTeam: "India", awayTeam: "Australia" });
    setHook({ matches: [football, cricket], visibleMatches: [football, cricket] });

    render(<Dashboard />);

    expect(screen.getByRole("button", { name: /football/i })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /cricket/i })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /basketball/i })).toHaveTextContent("0");
  });

  it("shows the empty feed state until a match is tuned in", () => {
    setHook({ matches: [match()], visibleMatches: [match()] });
    render(<Dashboard />);

    expect(screen.getByText(/no match selected/i)).toBeInTheDocument();
  });

  it("renders commentary once a fixture is tuned in", () => {
    setHook({
      matches: [match()],
      visibleMatches: [match()],
      tunedMatch: match(),
      tunedMatchId: 1,
      roomSubscribers: 3,
      commentary: [commentary()],
    });

    render(<Dashboard />);

    expect(screen.getByText(/now watching/i)).toBeInTheDocument();
    expect(screen.getByText("GOAL!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unsubscribe/i })).toBeInTheDocument();
  });

  it("shows the feed skeleton while the tuned fixture's history loads", () => {
    setHook({
      matches: [match()],
      visibleMatches: [match()],
      tunedMatch: match(),
      tunedMatchId: 1,
      isLoadingFeed: true,
      commentary: [],
    });

    render(<Dashboard />);

    expect(screen.getByLabelText(/loading commentary/i)).toBeInTheDocument();
  });
});

describe("Dashboard — interactions", () => {
  it("tunes in when a card's Watch live is clicked", async () => {
    const user = userEvent.setup();
    const tuneIn = vi.fn();
    const one = match({ id: 42 });
    setHook({ matches: [one], visibleMatches: [one], tuneIn });

    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /watch live/i }));

    expect(tuneIn).toHaveBeenCalledWith(42);
  });

  it("re-syncs on demand", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setHook({ refetch, matches: [match()], visibleMatches: [match()] });

    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /re-sync/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("changes the sport filter", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    setHook({ setFilter, matches: [match()], visibleMatches: [match()] });

    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /cricket/i }));

    expect(setFilter).toHaveBeenCalledWith("cricket");
  });

  it("changes the page", async () => {
    const user = userEvent.setup();
    const setPage = vi.fn();
    setHook({ setPage, matches: [match()], visibleMatches: [match()], page: 1, totalPages: 3 });

    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(setPage).toHaveBeenCalledWith(2);
  });
});

describe("Dashboard — notifications", () => {
  it("announces a fixture that was not in the initial snapshot", async () => {
    const initial = match({ id: 1, homeTeam: "Arsenal" });
    const fresh = match({ id: 2, homeTeam: "Newcomers", awayTeam: "Rivals" });

    setHook({ matches: [fresh, initial], visibleMatches: [fresh, initial] });

    const { rerender } = render(<Dashboard initialMatches={[initial]} />);
    // The socket pushed a brand-new fixture into the hook's list.
    rerender(<Dashboard initialMatches={[initial]} />);

    expect(await screen.findByText(/new match scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/Newcomers 2 – 1 Rivals/)).toBeInTheDocument();
  });

  it("surfaces a realtime error as a toast", async () => {
    setHook({ matches: [match()], visibleMatches: [match()], error: "Rate limit exceeded" });

    render(<Dashboard />);

    expect(await screen.findByText(/realtime notice/i)).toBeInTheDocument();
    expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
  });

  it("does not replay the same error twice", async () => {
    setHook({ matches: [match()], visibleMatches: [match()], error: "Same failure" });

    const { rerender } = render(<Dashboard />);
    await screen.findByText("Same failure");
    rerender(<Dashboard />);

    expect(screen.getAllByText("Same failure")).toHaveLength(1);
  });
});
