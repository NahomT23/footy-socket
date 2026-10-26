"use client";

import { useEffect, useRef, useState } from "react";

import type { ScorePulse } from "@/hooks/useMatchData";
import {
  formatFullTimestamp,
  formatKickoff,
  resultLabel,
  SPORT_EMOJI,
  SPORT_LABEL,
  STATUS_LABEL,
  teamInitials,
} from "@/lib/format";
import { displayScore, formatOvers } from "@/lib/format";
import type { Match, Sport } from "@/lib/types";

export interface MatchCardProps {
  match: Match;
  isTunedIn: boolean;
  /** Latest score pulse, or null. Only pulses for this match are rendered. */
  pulse: ScorePulse | null;
  onWatch: (matchId: number) => void;
  onStopWatching: (matchId: number) => void;
}

/** One score box; flashes yellow when its value just changed. */
function ScoreBox({
  value,
  side,
  flashing,
  flashNonce,
  label,
}: {
  /** Already formatted for the sport (e.g. `170/4` for cricket). */
  value: string;
  side: "home" | "away";
  flashing: boolean;
  /** Changes on every score event; remounting restarts the CSS keyframes. */
  flashNonce: number;
  label: string;
}) {
  return (
    <div
      aria-label={`${label}: ${value}`}
      key={flashing ? flashNonce : "idle"}
      data-side={side}
      data-flashing={flashing || undefined}
      className={`brutal-sm flex h-12 min-w-12 shrink-0 items-center justify-center px-2 font-mono text-xl font-black tabular-nums ${
        flashing ? "score-pulse border-ink" : "bg-white"
      }`}
    >
      {value}
    </div>
  );
}

function StatusChip({ match }: { match: Match }) {
  if (match.status === "live") {
    return (
      <span className="brutal-sm inline-flex items-center gap-1.5 bg-danger px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
        <span className="live-beacon inline-block size-1.5 rounded-full bg-white" aria-hidden="true" />
        Live
      </span>
    );
  }

  if (match.status === "finished") {
    return (
      <span className="brutal-sm inline-flex items-center bg-ink px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
        Finished
      </span>
    );
  }

  return (
    <span className="brutal-sm inline-flex items-center bg-soft px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
      {STATUS_LABEL.scheduled}
    </span>
  );
}

export function MatchCard({
  match,
  isTunedIn,
  pulse,
  onWatch,
  onStopWatching,
}: MatchCardProps) {
  // Which side is currently flashing.
  //
  // The pulse is a broadcast delivered as a prop, so a *new* nonce must be
  // detected during render and remembered; doing it in an effect instead would
  // paint one frame with a stale side and then cascade a second render. This is
  // React's documented "adjust state when a prop changes" escape hatch, and the
  // lint rule is disabled only across these four lines.
  const goalsRef = useRef({ nonce: 0, side: null as "home" | "away" | null });
  const [pulseState, setPulseState] = useState<{ side: "home" | "away"; nonce: number } | null>(null);

  /* eslint-disable react-hooks/refs -- see comment above */
  const incomingPulse =
    pulse && pulse.matchId === match.id && pulse.nonce !== goalsRef.current.nonce ? pulse : null;

  if (incomingPulse) {
    goalsRef.current = { nonce: incomingPulse.nonce, side: incomingPulse.side };
    if (!pulseState || pulseState.nonce !== incomingPulse.nonce) {
      setPulseState({ side: incomingPulse.side, nonce: incomingPulse.nonce });
    }
  }
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (!pulseState) return;
    const timer = window.setTimeout(() => setPulseState(null), 1150);
    return () => window.clearTimeout(timer);
  }, [pulseState]);

  const flashing = pulseState?.side ?? null;
  const flashNonce = pulseState?.nonce ?? 0;

  const sport = match.sport as Sport;
  const homeOvers = formatOvers(match.homeOvers);
  const awayOvers = formatOvers(match.awayOvers);
  const emoji = SPORT_EMOJI[sport] ?? "🏆";
  const sportLabel = SPORT_LABEL[sport] ?? match.sport;
  const result = resultLabel(match);
  const canWatch = match.status === "live";

  return (
    <article
      aria-label={`${sportLabel}: ${match.homeTeam} versus ${match.awayTeam}`}
      className={`brutal-interactive brutal-press relative flex flex-col gap-4 bg-white p-4 ${
        isTunedIn ? "ring-4 ring-accent" : ""
      }`}
    >
      {/* Header: sport, status, kickoff */}
      <header className="flex items-center justify-between gap-2">
        <span className="brutal-sm inline-flex items-center gap-1.5 bg-accent px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
          <span aria-hidden="true">{emoji}</span>
          {sportLabel}
        </span>
        <StatusChip match={match} />
      </header>

      {/* Teams + scores */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="brutal-sm flex size-7 shrink-0 items-center justify-center bg-soft font-mono text-[10px] font-black"
            >
              {teamInitials(match.homeTeam)}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black uppercase tracking-tight" title={match.homeTeam}>
                {match.homeTeam}
              </h3>
              {homeOvers && (
                <p className="font-mono text-[10px] font-bold uppercase text-ink/50">{homeOvers}</p>
              )}
            </div>
          </div>
          <ScoreBox
            value={displayScore(match, "home")}
            side="home"
            flashing={flashing === "home"}
            flashNonce={flashNonce}
            label={`${match.homeTeam} score`}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="brutal-sm flex size-7 shrink-0 items-center justify-center bg-white font-mono text-[10px] font-black"
            >
              {teamInitials(match.awayTeam)}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black uppercase tracking-tight" title={match.awayTeam}>
                {match.awayTeam}
              </h3>
              {awayOvers && (
                <p className="font-mono text-[10px] font-bold uppercase text-ink/50">{awayOvers}</p>
              )}
            </div>
          </div>
          <ScoreBox
            value={displayScore(match, "away")}
            side="away"
            flashing={flashing === "away"}
            flashNonce={flashNonce}
            label={`${match.awayTeam} score`}
          />
        </div>
      </div>

      {/* Footer: kickoff / result + action */}
      <footer className="mt-auto flex items-center justify-between gap-2 border-t-2 border-ink pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-tight text-ink/70" title={formatFullTimestamp(match.startTime)}>
          {match.status === "finished" && result ? result : formatKickoff(match.startTime)}
        </p>

        {canWatch ? (
          <button
            type="button"
            onClick={() => (isTunedIn ? onStopWatching(match.id) : onWatch(match.id))}
            aria-pressed={isTunedIn}
            className={`brutal-sm brutal-press px-3 py-1.5 text-[11px] font-black uppercase tracking-wide ${
              isTunedIn ? "bg-ink text-white" : "bg-accent text-ink"
            }`}
          >
            {isTunedIn ? "◼ Stop watching" : "▶ Watch live"}
          </button>
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink/40">
            {match.status === "finished" ? "Full time" : "Not started"}
          </span>
        )}
      </footer>
    </article>
  );
}

export default MatchCard;
