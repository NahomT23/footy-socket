"use client";

import { MATCHES_PER_PAGE, type SportFilter } from "@/hooks/useMatchData";

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

/**
 * Windowed pager: always shows first/last with ellipses, and never more than
 * five numeric targets so the control stays a fixed width.
 */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);

  const result: (number | "gap")[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) result.push("gap");
    result.push(value);
    previous = value;
  }
  return result;
}

export function Pagination({ page, totalPages, totalItems, onPageChange }: PaginationProps) {
  if (totalItems === 0) return null;

  const from = (page - 1) * MATCHES_PER_PAGE + 1;
  const to = Math.min(page * MATCHES_PER_PAGE, totalItems);

  return (
    <nav aria-label="Match pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-ink/70">
        Showing {from}–{to} of {totalItems}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="brutal-sm brutal-press bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          ← Prev
        </button>

        <ul className="flex items-center gap-1.5">
          {pageWindow(page, totalPages).map((entry, index) =>
            entry === "gap" ? (
              <li key={`gap-${index}`} className="px-1 font-black" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={entry}>
                <button
                  type="button"
                  onClick={() => onPageChange(entry)}
                  aria-current={entry === page ? "page" : undefined}
                  aria-label={`Page ${entry}`}
                  className={`brutal-sm brutal-press size-8 text-[11px] font-black ${
                    entry === page ? "bg-ink text-white" : "bg-white"
                  }`}
                >
                  {entry}
                </button>
              </li>
            )
          )}
        </ul>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="brutal-sm brutal-press bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          Next →
        </button>
      </div>
    </nav>
  );
}

export const SPORT_FILTERS: { value: SportFilter; label: string; emoji: string }[] = [
  { value: "all", label: "All sports", emoji: "🏆" },
  { value: "football", label: "Football", emoji: "⚽" },
  { value: "cricket", label: "Cricket", emoji: "🏏" },
  { value: "basketball", label: "Basketball", emoji: "🏀" },
];

export interface SportFilterBarProps {
  value: SportFilter;
  counts: Record<SportFilter, number>;
  onChange: (value: SportFilter) => void;
}

export function SportFilterBar({ value, counts, onChange }: SportFilterBarProps) {
  return (
    <div role="group" aria-label="Filter by sport" className="flex flex-wrap items-center gap-2">
      {SPORT_FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`brutal-sm brutal-press flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide ${
              active ? "bg-ink text-white" : "bg-white"
            }`}
          >
            <span aria-hidden="true">{option.emoji}</span>
            {option.label}
            <span
              className={`ml-0.5 border-l-2 pl-1.5 font-mono ${
                active ? "border-white/40" : "border-ink/20"
              }`}
            >
              {counts[option.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
