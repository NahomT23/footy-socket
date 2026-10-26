"use client";

import { useEffect, useMemo, useRef } from "react";

import { MatchCard } from "@/components/MatchCard";
import { Pagination, SportFilterBar } from "@/components/Pagination";
import { MatchGridSkeleton, LiveFeedSkeleton } from "@/components/Skeletons";
import { StatusIndicator } from "@/components/StatusIndicator";
import { LiveFeed } from "@/components/LiveFeed";
import { ToastStack, useToast } from "@/components/ToastStack";
import { MATCHES_PER_PAGE, useMatchData, type SportFilter } from "@/hooks/useMatchData";
import { scoreLine } from "@/lib/format";
import type { Match } from "@/lib/types";

export interface DashboardProps {
  initialMatches?: Match[];
}

/**
 * The interactive dashboard shell.
 *
 * It is a Client Component because everything it shows is pushed from the
 * server after the first paint; the initial snapshot arrives as a prop so the
 * grid is never empty while the socket handshakes.
 */
export function Dashboard({ initialMatches = [] }: DashboardProps) {
  const {
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
    page,
    totalPages,
    filter,
    latestPulse,
    refetch,
    setPage,
    setFilter,
    tuneIn,
    tuneOut,
  } = useMatchData({ initialMatches });

  const { toasts, push, dismiss } = useToast();

  /* ------------------------------------------------------------------ */
  /* Announce brand-new fixtures                                         */
  /* ------------------------------------------------------------------ */

  // Matches that existed at mount (or in the SSR snapshot) are not "news".
  const seenIdsRef = useRef<Set<number>>(new Set(initialMatches.map((match) => match.id)));

  useEffect(() => {
    for (const match of matches) {
      if (seenIdsRef.current.has(match.id)) continue;
      seenIdsRef.current.add(match.id);
      push({ title: "New match scheduled", description: scoreLine(match), tone: "info" });
    }
  }, [matches, push]);

  // Errors (including server-side rate limits) surface as toasts exactly once.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error || error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    push({ title: "Realtime notice", description: error, tone: "error" });
  }, [error, push]);

  /* ------------------------------------------------------------------ */
  /* Derived counters                                                    */
  /* ------------------------------------------------------------------ */

  const counts = useMemo(() => {
    const base: Record<SportFilter, number> = {
      all: matches.length,
      football: 0,
      cricket: 0,
      basketball: 0,
    };
    for (const match of matches) {
      if (match.sport === "football") base.football += 1;
      else if (match.sport === "cricket") base.cricket += 1;
      else if (match.sport === "basketball") base.basketball += 1;
    }
    return base;
  }, [matches]);

  const liveCount = useMemo(() => matches.filter((match) => match.status === "live").length, [matches]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
      {/* ------------------------------------------------------------ */}
      {/* Header                                                        */}
      {/* ------------------------------------------------------------ */}
      <header className="brutal bg-accent p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-ink/70">
              Real-time sports coverage
            </p>
            <h1 className="mt-1 text-3xl leading-none font-black uppercase tracking-tighter sm:text-4xl">
              Sportz<span className="text-ink/40">.</span>live
            </h1>
            <p className="mt-2 max-w-prose text-sm font-medium text-ink/80">
              Every score change and commentary line is pushed over Socket.IO rooms — nothing here needs a
              page refresh.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <StatusIndicator status={status} subscribers={roomSubscribers} />
            <button
              type="button"
              onClick={() => void refetch()}
              className="brutal-sm brutal-press bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wide"
            >
              ⟳ Re-sync
            </button>
          </div>
        </div>

        {/* Stat strip */}
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Fixtures", value: counts.all },
            { label: "Live now", value: liveCount },
            { label: "Subscribed", value: subscribedMatchIds.length },
            { label: "Per page", value: MATCHES_PER_PAGE },
          ].map((stat) => (
            <div key={stat.label} className="brutal-sm bg-white px-3 py-2">
              <dt className="text-[10px] font-black uppercase tracking-widest text-ink/60">{stat.label}</dt>
              <dd className="font-mono text-xl font-black tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <SportFilterBar value={filter} counts={counts} onChange={setFilter} />

      {/* ------------------------------------------------------------ */}
      {/* Grid + feed                                                   */}
      {/* ------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Matches" className="flex flex-col gap-5">
          {isLoading ? (
            <MatchGridSkeleton count={MATCHES_PER_PAGE} />
          ) : visibleMatches.length === 0 ? (
            <div className="brutal bg-white p-8 text-center">
              <p className="text-lg font-black uppercase tracking-tight">No fixtures here yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-ink/70">
                Real fixtures sync automatically from ESPN — today plus the last three
                days. Pick another sport, or check back near kickoff; nothing to
                configure or run.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleMatches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  isTunedIn={tunedMatchId === match.id}
                  pulse={latestPulse}
                  onWatch={tuneIn}
                  onStopWatching={tuneOut}
                />
              ))}
            </div>
          )}

          {!isLoading && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={
                filter === "all" ? counts.all : counts[filter as Exclude<SportFilter, "all">]
              }
              onPageChange={setPage}
            />
          )}
        </section>

        <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          {isLoadingFeed && tunedMatchId !== null && commentary.length === 0 ? (
            <LiveFeedSkeleton />
          ) : (
            <LiveFeed
              match={tunedMatch}
              commentary={commentary}
              isLoading={isLoadingFeed}
              subscribers={roomSubscribers}
              onStopWatching={tuneOut}
            />
          )}
        </div>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default Dashboard;
