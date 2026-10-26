import { Suspense } from "react";
import { connection } from "next/server";

import { Dashboard } from "@/components/Dashboard";
import { MatchGridSkeleton } from "@/components/Skeletons";
import { listMatches } from "@/lib/queries";
import type { Match } from "@/lib/types";

/**
 * Server-rendered first paint.
 *
 * The dashboard is realtime and user-specific, so it must never be prerendered:
 * `connection()` opts this subtree into request-time rendering. The query then
 * runs on the server (no HTTP round trip) and the result is handed to the
 * Client Component as `initialMatches`, which the socket layer takes over from.
 */
async function DashboardWithData() {
  await connection();

  let initialMatches: Match[] = [];
  try {
    initialMatches = await listMatches(100);
  } catch (error) {
    // A cold database must not produce a 500 page: the client-side hook will
    // retry as soon as the socket connects.
    console.error("[page] initial match snapshot failed:", error);
  }

  return <Dashboard initialMatches={initialMatches} />;
}

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
            <div className="brutal mb-6 bg-accent p-6">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-ink/70">
                Real-time sports coverage
              </p>
              <h1 className="mt-1 text-3xl leading-none font-black uppercase tracking-tighter sm:text-4xl">
                Sportz<span className="text-ink/40">.</span>live
              </h1>
            </div>
            <MatchGridSkeleton />
          </div>
        }
      >
        <DashboardWithData />
      </Suspense>
    </main>
  );
}
