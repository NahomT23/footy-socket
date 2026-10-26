/**
 * Loading placeholders.
 *
 * They mirror the real layout's geometry so streaming in real content does not
 * shift the page (no cumulative layout shift).
 */
export function MatchCardSkeleton() {
  return (
    <div className="brutal flex flex-col gap-4 bg-white p-4" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="skeleton h-4 w-24 rounded-sm" />
        <div className="skeleton h-4 w-16 rounded-sm" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="skeleton size-7 rounded-sm" />
              <div className="skeleton h-4 w-32 rounded-sm" />
            </div>
            <div className="skeleton size-12 rounded-sm" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t-2 border-ink pt-3">
        <div className="skeleton h-3 w-20 rounded-sm" />
        <div className="skeleton h-7 w-24 rounded-sm" />
      </div>
    </div>
  );
}

export function MatchGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-label="Loading matches"
    >
      {Array.from({ length: count }).map((_, index) => (
        <MatchCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function LiveFeedSkeleton() {
  return (
    <div className="brutal h-full bg-white p-4" aria-busy="true" aria-label="Loading commentary">
      <ul className="flex flex-col gap-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="border-l-4 border-ink pl-4">
            <div className="skeleton h-3 w-24 rounded-sm" />
            <div className="skeleton mt-2 h-3 w-full rounded-sm" />
            <div className="skeleton mt-2 h-3 w-3/4 rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}
