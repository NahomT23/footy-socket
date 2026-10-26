"use client";

import { useEffect, useState } from "react";

import {
  displayScore,
  eventBadgeClass,
  eventBadgeLabel,
  formatFullTimestamp,
  formatMinute,
  formatOvers,
  formatRelative,
  SPORT_EMOJI,
} from "@/lib/format";
import type { Commentary, Match, Sport } from "@/lib/types";

export interface LiveFeedProps {
  match: Match | null;
  commentary: Commentary[];
  isLoading: boolean;
  /** Number of sockets currently in this fixture's room. */
  subscribers?: number;
  onStopWatching: () => void;
}

/** Human label for a metadata key: `homeScore` -> `Home Score`. */
function metadataLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function metadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function EntryRow({ entry, isNewest }: { entry: Commentary; isNewest: boolean }) {
  const minute = formatMinute(entry.minute);
  const badge = eventBadgeLabel(entry.eventType);
  const metadata = entry.metadata ? Object.entries(entry.metadata).slice(0, 4) : [];

  return (
    <li
      className={`relative border-l-4 border-ink pl-4 ${isNewest ? "feed-enter" : ""}`}
      aria-label={entry.message}
    >
      {/* Timeline node */}
      <span
        aria-hidden="true"
        className={`brutal-sm absolute -left-[9px] top-1 size-3.5 rounded-full ${
          isNewest ? "bg-accent" : "bg-white"
        }`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {minute && (
          <span className="brutal-sm bg-accent px-1.5 py-0.5 font-mono text-[11px] font-black">{minute}</span>
        )}
        {badge && (
          <span
            className={`brutal-sm px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${eventBadgeClass(entry.eventType)}`}
          >
            {badge}
          </span>
        )}
        {entry.period && (
          <span className="brutal-sm bg-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            {entry.period}
          </span>
        )}
        <time
          dateTime={entry.createdAt}
          title={formatFullTimestamp(entry.createdAt)}
          className="ml-auto font-mono text-[10px] uppercase text-ink/50"
        >
          {formatRelative(entry.createdAt)}
        </time>
      </div>

      {(entry.actor || entry.team) && (
        <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-ink/80">
          {[entry.actor, entry.team].filter(Boolean).join(" · ")}
        </p>
      )}

      <p className="mt-0.5 text-sm leading-snug font-medium">{entry.message}</p>

      {metadata.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-1.5">
          {metadata.map(([key, value]) => (
            <div
              key={key}
              className="brutal-sm flex items-center gap-1 bg-white px-1.5 py-0.5 font-mono text-[10px]"
            >
              <dt className="uppercase text-ink/60">{metadataLabel(key)}</dt>
              <dd className="font-bold">{metadataValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {entry.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <li key={tag} className="text-[10px] font-bold uppercase tracking-wide text-ink/50">
              #{tag}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function EmptyState({ match }: { match: null | Match }) {
  return (
    <div className="brutal flex h-full flex-col items-center justify-center gap-3 bg-white p-8 text-center">
      <span aria-hidden="true" className="text-4xl">
        📺
      </span>
      <h3 className="text-lg font-black uppercase tracking-tight">
        {match ? "Match finished" : "No match selected"}
      </h3>
      <p className="max-w-xs text-sm font-medium text-ink/70">
        {match
          ? `${match.homeTeam} vs ${match.awayTeam} has ended — subscriptions were detached automatically.`
          : "Pick a live fixture and hit “Watch live” to stream play-by-play commentary in real time."}
      </p>
    </div>
  );
}

export function LiveFeed({
  match,
  commentary,
  isLoading,
  subscribers = 0,
  onStopWatching,
}: LiveFeedProps) {
  // Relative timestamps ("12s ago") need a nudge to stay honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!match) {
    return (
      <aside aria-label="Live commentary" className="h-full">
        <EmptyState match={null} />
      </aside>
    );
  }

  const sport = match.sport as Sport;
  const cricket = match.sport === "cricket";
  const homeOvers = formatOvers(match.homeOvers);
  const awayOvers = formatOvers(match.awayOvers);

  return (
    <aside aria-label={`Live commentary for ${match.homeTeam} vs ${match.awayTeam}`} className="flex h-full flex-col gap-3">
      {/* Tuned-in fixture header */}
      <header className="brutal bg-accent p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-ink/70">
              {SPORT_EMOJI[sport] ?? "🏆"} Now watching
            </p>
            <h2 className="truncate text-base font-black uppercase tracking-tight" title={`${match.homeTeam} vs ${match.awayTeam}`}>
              {match.homeTeam}{" "}
              <span className="font-mono" data-testid="feed-score">
                {cricket
                  ? `${displayScore(match, "home")}–${displayScore(match, "away")}`
                  : `${match.homeScore}–${match.awayScore}`}
              </span>{" "}
              {match.awayTeam}
            </h2>
            {(homeOvers || awayOvers) && (
              <p className="mt-0.5 font-mono text-[10px] font-bold uppercase text-ink/60" data-testid="feed-overs">
                {homeOvers && `${match.homeTeam} ${homeOvers}`}
                {homeOvers && awayOvers && " · "}
                {awayOvers && `${match.awayTeam} ${awayOvers}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onStopWatching}
            className="brutal-sm brutal-press shrink-0 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide"
          >
            Unsubscribe
          </button>
        </div>
        <p className="mt-2 flex items-center gap-3 font-mono text-[10px] uppercase text-ink/70">
          <span data-testid="feed-room" data-room={`match:${match.id}`} data-match-id={match.id}>
            room match:{match.id}
          </span>
          <span data-testid="feed-subscribers" data-subscribers={subscribers}>
            {subscribers} subscriber{subscribers === 1 ? "" : "s"}
          </span>
          <span data-testid="feed-event-count" data-events={commentary.length}>
            {commentary.length} events
          </span>
        </p>
      </header>

      {/* Feed */}
      <div className="brutal min-h-0 flex-1 overflow-y-auto bg-white p-4">
        {isLoading && commentary.length === 0 ? (
          <ul className="flex flex-col gap-4" aria-busy="true" aria-label="Loading commentary">
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index} className="border-l-4 border-ink pl-4">
                <div className="skeleton h-3 w-20 rounded-sm" />
                <div className="skeleton mt-2 h-3 w-full rounded-sm" />
                <div className="skeleton mt-2 h-3 w-2/3 rounded-sm" />
              </li>
            ))}
          </ul>
        ) : commentary.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span aria-hidden="true" className="text-2xl">
              ⏱️
            </span>
            <p className="text-sm font-bold uppercase tracking-wide">Waiting for kick-off</p>
            <p className="max-w-[22ch] text-xs font-medium text-ink/60">
              Commentary events will appear here the moment they are broadcast to this room.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">
            {commentary.map((entry, index) => (
              <EntryRow key={entry.id} entry={entry} isNewest={index === 0} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

export default LiveFeed;
