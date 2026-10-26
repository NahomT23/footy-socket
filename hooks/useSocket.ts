"use client";

/**
 * Socket.IO connection lifecycle for the dashboard.
 *
 * Responsibility: own exactly one socket, expose its health, and expose stable
 * `join`/`leave` callbacks. It deliberately knows nothing about matches so the
 * data hook (`useMatchData`) can be tested against a fake transport.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import {
  SERVER_TO_CLIENT_EVENTS,
  SOCKET_EVENTS,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SubscriptionAckPayload,
} from "@/lib/types";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type SportzSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketOptions {
  /** Stable object of listeners installed once per connection. */
  handlers?: Partial<ServerToClientEvents>;
  enabled?: boolean;
}

export interface UseSocketResult {
  status: ConnectionStatus;
  socketId: string | null;
  transport: string | null;
  /** Number of reconnection attempts since the last successful connect. */
  attempts: number;
  /** Subscribes to a fixture room. `onAck` receives the server's confirmation. */
  joinMatch: (matchId: number, onAck?: (ack: SubscriptionAckPayload) => void) => void;
  leaveMatch: (matchId: number, onAck?: (ack: SubscriptionAckPayload) => void) => void;
}

/**
 * Keeps listeners in a ref so callers can pass inline closures without
 * re-installing handlers (and re-triggering effects) on every render.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useSocket({ handlers, enabled = true }: UseSocketOptions = {}): UseSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>(enabled ? "connecting" : "disconnected");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [transport, setTransport] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const socketRef = useRef<SportzSocket | null>(null);
  const handlersRef = useLatest(handlers ?? {});

  /** The room this client is currently subscribed to, if any. */
  const roomRef = useRef<number | null>(null);

  useEffect(() => {
    // `enabled: false` is a caller-side opt-out; the initial state already
    // reflects it, so there is nothing to synchronise here.
    if (!enabled) return;

    const socket: SportzSocket = io({
      path: "/socket.io",
      // Same-origin by default; explicit transports give us polling -> upgrade.
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
    });

    socketRef.current = socket;

    // Test hook: lets the E2E suite force a genuine transport drop and observe
    // reconnection. Development/test only - never shipped in production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __sportz?: { disconnect: () => void; connect: () => void } }).__sportz = {
        disconnect: () => socket.disconnect(),
        connect: () => socket.connect(),
      };
    }

    socket.on("connect", () => {
      setSocketId(socket.id ?? null);
      setTransport(socket.io.engine.transport.name);
      setAttempts(0);
      setStatus("connected");

      // Re-establish the subscription: a reconnect creates a *new* server-side
      // socket, so the previous room membership is gone. Removing this would
      // leave the client silently receiving nothing after a blip.
      if (roomRef.current !== null) {
        socket.emit(SOCKET_EVENTS.joinMatch, { matchId: roomRef.current });
      }
    });

    // The Manager emits `upgrade` with the *new* transport; `engine` is typed
    // loosely by socket.io-client, so narrow it explicitly here.
    const manager = socket.io as unknown as {
      on(event: string, listener: (...args: unknown[]) => void): void;
    };
    manager.on("upgrade", (...args: unknown[]) => {
      const upgraded = args[0] as { name?: string } | undefined;
      if (upgraded?.name) setTransport(upgraded.name);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      setAttempts(attempt);
      setStatus("reconnecting");
    });

    socket.on("disconnect", () => {
      setTransport(null);
      setStatus("reconnecting");
    });

    socket.io.on("reconnect_failed", () => setStatus("disconnected"));

    // Install domain listeners once; the ref always holds the latest closures.
    for (const event of SERVER_TO_CLIENT_EVENTS) {
      socket.on(event as never, ((...args: unknown[]) => {
        const handler = (handlersRef.current as Record<string, unknown>)[event];
        if (typeof handler === "function") {
          (handler as (...inner: unknown[]) => void)(...args);
        }
      }) as never);
    }

    const onOnline = () => {
      if (!socket.connected) socket.connect();
    };
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("online", onOnline);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, handlersRef]);

  const joinMatch = useCallback(
    (matchId: number, onAck?: (ack: SubscriptionAckPayload) => void) => {
      const socket = socketRef.current;
      if (!socket) return;
      roomRef.current = matchId;
      // Optimistic join: even if the socket is mid-reconnect, Socket.IO queues
      // the emit and the server adds the room on the next handshake.
      socket.emit(SOCKET_EVENTS.joinMatch, { matchId }, (ack) => onAck?.(ack));
    },
    []
  );

  const leaveMatch = useCallback(
    (matchId: number, onAck?: (ack: SubscriptionAckPayload) => void) => {
      if (roomRef.current === matchId) roomRef.current = null;
      socketRef.current?.emit(SOCKET_EVENTS.leaveMatch, { matchId }, (ack) => onAck?.(ack));
    },
    []
  );

  return { status, socketId, transport, attempts, joinMatch, leaveMatch };
}
