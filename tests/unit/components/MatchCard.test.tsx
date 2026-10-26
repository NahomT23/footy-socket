/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchCard } from "@/components/MatchCard";
import type { Match } from "@/lib/types";

const match = (overrides: Partial<Match> = {}): Match => ({
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
});

function renderCard(props: Partial<React.ComponentProps<typeof MatchCard>> = {}) {
  const handlers = {
    onWatch: vi.fn(),
    onStopWatching: vi.fn(),
  };
  const view = render(
    <MatchCard match={match()} isTunedIn={false} pulse={null} {...handlers} {...props} />
  );
  return { ...view, ...handlers };
}

describe("MatchCard", () => {
  it("renders both teams with their scores in labelled boxes", () => {
    renderCard();
    expect(screen.getByText("Arsenal")).toBeInTheDocument();
    expect(screen.getByText("Chelsea")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Arsenal score: 2$/)).toHaveTextContent("2");
    expect(screen.getByLabelText(/^Chelsea score: 1$/)).toHaveTextContent("1");
  });

  it("labels the card for assistive technology", () => {
    renderCard();
    expect(screen.getByRole("article", { name: /football: Arsenal versus Chelsea/i })).toBeInTheDocument();
  });

  it("shows a Live badge and a Watch live action for a live fixture", () => {
    renderCard();
    expect(screen.getByText(/^live$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /watch live/i })).toBeInTheDocument();
  });

  it("calls onWatch with the match id when Watch live is clicked", async () => {
    const user = userEvent.setup();
    const { onWatch, onStopWatching } = renderCard();

    await user.click(screen.getByRole("button", { name: /watch live/i }));

    expect(onWatch).toHaveBeenCalledWith(1);
    expect(onStopWatching).not.toHaveBeenCalled();
  });

  it("shows a Stop watching action and reports onStopWatching when tuned in", async () => {
    const user = userEvent.setup();
    const { onWatch, onStopWatching } = renderCard({ isTunedIn: true });

    const button = screen.getByRole("button", { name: /stop watching/i });
    expect(button).toHaveAttribute("aria-pressed", "true");

    await user.click(button);
    expect(onStopWatching).toHaveBeenCalledWith(1);
    expect(onWatch).not.toHaveBeenCalled();
  });

  it("renders a sport tag for each sport", () => {
    const { unmount } = renderCard({ match: match({ sport: "cricket" }) });
    expect(screen.getByText(/cricket/i)).toBeInTheDocument();
    unmount();

    renderCard({ match: match({ sport: "basketball" }) });
    expect(screen.getByText(/basketball/i)).toBeInTheDocument();
  });

  it("offers no watch action before kick-off", () => {
    renderCard({ match: match({ status: "scheduled", startTime: new Date(Date.now() + 3_600_000).toISOString() }) });
    expect(screen.queryByRole("button", { name: /watch live/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByText(/scheduled/i)).toBeInTheDocument();
  });

  it("locks a finished fixture and reports the result", () => {
    renderCard({ match: match({ status: "finished", homeScore: 3, awayScore: 1 }) });
    expect(screen.getByText(/finished/i)).toBeInTheDocument();
    expect(screen.getByText(/Arsenal win/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /watch live/i })).not.toBeInTheDocument();
  });

  it("flashes only the side that scored when a pulse arrives", async () => {
    const { rerender } = render(
      <MatchCard match={match()} isTunedIn={false} pulse={null} onWatch={vi.fn()} onStopWatching={vi.fn()} />
    );

    // jest-dom's matcher takes no timeout options, so poll explicitly.
    await waitFor(() => {
      const box = screen.queryByLabelText(/^Arsenal score: \d+$/);
      expect(box === null || !box.hasAttribute("data-flashing")).toBe(true);
    });

    rerender(
      <MatchCard
        match={match({ homeScore: 3 })}
        isTunedIn={false}
        pulse={{ matchId: 1, side: "home", nonce: 1 }}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^Arsenal score: \d+$/)).toHaveAttribute("data-flashing", "true")
    );
    expect(screen.getByLabelText(/^Chelsea score: \d+$/)).not.toHaveAttribute("data-flashing");
  });

  it("clears the flash once the animation finishes", async () => {
    const { rerender } = render(
      <MatchCard match={match()} isTunedIn={false} pulse={null} onWatch={vi.fn()} onStopWatching={vi.fn()} />
    );

    rerender(
      <MatchCard
        match={match({ homeScore: 3 })}
        isTunedIn={false}
        pulse={{ matchId: 1, side: "home", nonce: 1 }}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^Arsenal score: \d+$/)).toHaveAttribute("data-flashing", "true")
    );
    // The component clears itself after the 1.15s keyframe window.
    await waitFor(
      () => expect(screen.getByLabelText(/^Arsenal score: \d+$/)).not.toHaveAttribute("data-flashing"),
      { timeout: 3_000 }
    );
  });

  it("ignores a pulse addressed to another fixture", async () => {
    render(
      <MatchCard
        match={match({ homeScore: 3 })}
        isTunedIn={false}
        pulse={{ matchId: 99, side: "home", nonce: 1 }}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByLabelText(/^Arsenal score: \d+$/)).not.toHaveAttribute("data-flashing");
  });

  it("highlights the card when it is the tuned fixture", () => {
    const { container } = renderCard({ isTunedIn: true });
    expect(container.querySelector("article")?.className).toContain("ring-accent");
  });
});
