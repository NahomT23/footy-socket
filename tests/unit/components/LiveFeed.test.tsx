/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LiveFeed } from "@/components/LiveFeed";
import type { Commentary, Match } from "@/lib/types";

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 12,
  sport: "football",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  status: "live",
  startTime: new Date(Date.now() - 30 * 60_000).toISOString(),
  endTime: new Date(Date.now() + 60 * 60_000).toISOString(),
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
});

const entry = (overrides: Partial<Commentary> = {}): Commentary => ({
  id: 1,
  matchId: 12,
  minute: 45,
  sequence: 3,
  period: "First Half",
  eventType: "goal",
  actor: "Bukayo Saka",
  team: "Arsenal",
  message: "GOAL! Saka curls it into the far corner.",
  metadata: null,
  tags: [],
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  ...overrides,
});

const noop = vi.fn();

describe("LiveFeed — empty state", () => {
  it("prompts the user to pick a fixture when nothing is tuned in", () => {
    render(<LiveFeed match={null} commentary={[]} isLoading={false} onStopWatching={noop} />);
    expect(screen.getByText(/no match selected/i)).toBeInTheDocument();
    expect(screen.getByText(/watch live/i)).toBeInTheDocument();
  });

  it("keeps showing a finished match's header and history", () => {
    // The room is detached server-side, but the user can still read what
    // happened: the feed keeps rendering the final score and the log.
    render(
      <LiveFeed
        match={match({ status: "finished" })}
        commentary={[entry()]}
        isLoading={false}
        onStopWatching={noop}
      />
    );

    expect(screen.getByText(/now watching/i)).toBeInTheDocument();
    expect(screen.getByText(/GOAL! Saka curls it into the far corner./)).toBeInTheDocument();
  });
});

describe("LiveFeed — tuned-in fixture", () => {
  it("shows the teams, live score and room in the header", () => {
    render(<LiveFeed match={match()} commentary={[entry()]} isLoading={false} subscribers={2} onStopWatching={noop} />);

    const feed = screen.getByRole("complementary", { name: /live commentary for Arsenal vs Chelsea/i });
    expect(within(feed).getByText(/now watching/i)).toBeInTheDocument();
    expect(within(feed).getByText(/room match:12/i)).toBeInTheDocument();
    expect(within(feed).getByText(/2 subscribers/i)).toBeInTheDocument();
  });

  it("uses the singular for one subscriber", () => {
    render(<LiveFeed match={match()} commentary={[]} isLoading={false} subscribers={1} onStopWatching={noop} />);
    expect(screen.getByText(/1 subscriber/i)).toBeInTheDocument();
  });

  it("reports how many events are loaded", () => {
    render(
      <LiveFeed
        match={match()}
        commentary={[entry(), entry({ id: 2, sequence: 2 })]}
        isLoading={false}
        onStopWatching={noop}
      />
    );
    expect(screen.getByText(/2 events/i)).toBeInTheDocument();
  });

  it("unsubscribes when the Unsubscribe button is clicked", async () => {
    const user = userEvent.setup();
    const onStopWatching = vi.fn();
    render(<LiveFeed match={match()} commentary={[]} isLoading={false} onStopWatching={onStopWatching} />);

    await user.click(screen.getByRole("button", { name: /unsubscribe/i }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
  });
});

describe("LiveFeed — timeline", () => {
  it("renders badges, actors, periods and messages for an entry", () => {
    render(<LiveFeed match={match()} commentary={[entry()]} isLoading={false} onStopWatching={noop} />);

    expect(screen.getByText("GOAL")).toBeInTheDocument();
    expect(screen.getByText("45'")).toBeInTheDocument();
    expect(screen.getByText(/first half/i)).toBeInTheDocument();
    expect(screen.getByText(/Bukayo Saka · Arsenal/)).toBeInTheDocument();
    expect(screen.getByText(/GOAL! Saka curls it into the far corner./)).toBeInTheDocument();
  });

  it("renders structured metadata as labelled chips", () => {
    render(
      <LiveFeed
        match={match()}
        commentary={[entry({ metadata: { xg: 0.44, distanceYards: 20 } })]}
        isLoading={false}
        onStopWatching={noop}
      />
    );

    // camelCase keys are humanised for display.
    expect(screen.getByText(/xg/i)).toBeInTheDocument();
    expect(screen.getByText("0.44")).toBeInTheDocument();
    expect(screen.getByText(/distance yards/i)).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("renders tags when present", () => {
    render(
      <LiveFeed match={match()} commentary={[entry({ tags: ["goal", "counter"] })]} isLoading={false} onStopWatching={noop} />
    );
    expect(screen.getByText("#goal")).toBeInTheDocument();
    expect(screen.getByText("#counter")).toBeInTheDocument();
  });

  it("omits the minute badge for period-only sports", () => {
    render(
      <LiveFeed
        match={match({ sport: "cricket" })}
        commentary={[entry({ minute: null, period: "1st Innings", eventType: "wicket" })]}
        isLoading={false}
        onStopWatching={noop}
      />
    );

    expect(screen.getByText("WICKET")).toBeInTheDocument();
    expect(screen.getByText("1st Innings")).toBeInTheDocument();
    expect(screen.queryByText(/'$/)).not.toBeInTheDocument();
  });

  it("renders every entry, newest first as supplied", () => {
    render(
      <LiveFeed
        match={match()}
        commentary={[
          entry({ id: 3, message: "Newest event", sequence: 3 }),
          entry({ id: 2, message: "Middle event", sequence: 2 }),
          entry({ id: 1, message: "Oldest event", sequence: 1 }),
        ]}
        isLoading={false}
        onStopWatching={noop}
      />
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Newest event");
    expect(items[2]).toHaveTextContent("Oldest event");
  });

  it("shows a waiting state when the feed is live but empty", () => {
    render(<LiveFeed match={match()} commentary={[]} isLoading={false} onStopWatching={noop} />);
    expect(screen.getByText(/waiting for kick-off/i)).toBeInTheDocument();
  });

  it("shows skeletons while the first page of commentary loads", () => {
    const { container } = render(
      <LiveFeed match={match()} commentary={[]} isLoading onStopWatching={noop} />
    );
    expect(screen.getByLabelText(/loading commentary/i)).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});
