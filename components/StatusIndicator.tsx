"use client";

import type { ConnectionStatus } from "@/hooks/useSocket";

/**
 * Persistent connection-health pill.
 *
 * The user must always be able to tell whether the numbers on screen are
 * arriving live or whether they are looking at a frozen snapshot.
 */
const CONFIG: Record<
  ConnectionStatus,
  { label: string; dot: string; bg: string; pulse: boolean; hint: string }
> = {
  connected: {
    label: "Live",
    dot: "bg-success",
    bg: "bg-white",
    pulse: true,
    hint: "Connected — score and commentary updates arrive instantly",
  },
  connecting: {
    label: "Connecting",
    dot: "bg-warn",
    bg: "bg-white",
    pulse: true,
    hint: "Opening the realtime connection",
  },
  reconnecting: {
    label: "Reconnecting",
    dot: "bg-warn",
    bg: "bg-accent",
    pulse: true,
    hint: "Connection lost — retrying and re-syncing",
  },
  disconnected: {
    label: "Offline",
    dot: "bg-danger",
    bg: "bg-white",
    pulse: false,
    hint: "No realtime connection — pull to refresh",
  },
};

export interface StatusIndicatorProps {
  status: ConnectionStatus;
  /** Sockets currently holding a fixture subscription. */
  subscribers?: number;
  attempts?: number;
}

export function StatusIndicator({ status, subscribers = 0, attempts = 0 }: StatusIndicatorProps) {
  const config = CONFIG[status];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-status={status}
      title={config.hint}
      className={`brutal-sm inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${config.bg}`}
    >
      <span className="relative flex size-2.5">
        {config.pulse && (
          <span
            className={`live-beacon absolute inline-flex size-full rounded-full ${config.dot}`}
            aria-hidden="true"
          />
        )}
        <span className={`relative inline-flex size-2.5 rounded-full border border-ink ${config.dot}`} />
      </span>
      <span>{config.label}</span>
      {status === "reconnecting" && attempts > 0 && (
        <span className="font-mono text-[10px] opacity-70">#{attempts}</span>
      )}
      {subscribers > 0 && (
        <span className="border-l-2 border-ink pl-2 font-mono text-[10px]">
          {subscribers} in room
        </span>
      )}
    </div>
  );
}
