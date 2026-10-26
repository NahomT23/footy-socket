/**
 * @vitest-environment jsdom
 *
 * `useSocket` is tested against a stubbed `socket.io-client`, because what
 * matters is the *lifecycle contract*: one socket per mount, health reflected
 * in state, listeners bound once, and clean teardown on unmount.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/* socket.io-client stub                                               */
/* ------------------------------------------------------------------ */

type Listener = (...args: unknown[]) => void;

const ioMock = vi.hoisted(() => {
  const listeners = new Map<string, Set<Listener>>();
  const managerListeners = new Map<string, Set<Listener>>();

  const manager = {
    on(event: string, listener: Listener) {
      if (!managerListeners.has(event)) managerListeners.set(event, new Set());
      managerListeners.get(event)!.add(listener);
    },
    removeAllListeners() {
      managerListeners.clear();
    },
  };

  const socket = {
    id: "socket-1",
    connected: false,
    io: { engine: { transport: { name: "websocket" } }, on: manager.on.bind(manager), removeAllListeners: manager.removeAllListeners.bind(manager) },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return socket;
    },
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners() {
      listeners.clear();
      return socket;
    },
  };

  return {
    socket,
    manager,
    listeners,
    managerListeners,
    /** Fires every listener registered for an event. */
    fire(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    fireManager(event: string, ...args: unknown[]) {
      for (const listener of managerListeners.get(event) ?? []) listener(...args);
    },
    reset() {
      listeners.clear();
      managerListeners.clear();
      socket.emit.mockClear();
      socket.connect.mockClear();
      socket.disconnect.mockClear();
    },
    factory: vi.fn(() => socket),
  };
});

vi.mock("socket.io-client", () => ({ io: ioMock.factory }));

const { useSocket } = await import("@/hooks/useSocket");

beforeEach(() => {
  ioMock.reset();
  ioMock.factory.mockClear();
});

afterEach(() => {
  delete (window as unknown as { __sportz?: unknown }).__sportz;
});

/* ------------------------------------------------------------------ */

describe("useSocket", () => {
  it("starts in the connecting state", () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.status).toBe("connecting");
    expect(result.current.socketId).toBeNull();
  });

  it("opens exactly one socket on the expected path", () => {
    renderHook(() => useSocket());

    expect(ioMock.factory).toHaveBeenCalledTimes(1);
    expect(ioMock.factory).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/socket.io",
        transports: ["websocket", "polling"],
        reconnection: true,
      })
    );
  });

  it("reports connected state, socket id and transport after connect", async () => {
    const { result } = renderHook(() => useSocket());

    act(() => ioMock.fire("connect"));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.socketId).toBe("socket-1");
    expect(result.current.transport).toBe("websocket");
    expect(result.current.attempts).toBe(0);
  });

  it("updates the transport when the connection is upgraded", async () => {
    const { result } = renderHook(() => useSocket());
    act(() => ioMock.fire("connect"));

    act(() => ioMock.fireManager("upgrade", { name: "websocket" }));
    await waitFor(() => expect(result.current.transport).toBe("websocket"));
  });

  it("reports a reconnecting state with the attempt count", async () => {
    const { result } = renderHook(() => useSocket());

    act(() => ioMock.fireManager("reconnect_attempt", 3));

    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
    expect(result.current.attempts).toBe(3);
  });

  it("clears the transport and stays reconnecting on disconnect", async () => {
    const { result } = renderHook(() => useSocket());
    act(() => ioMock.fire("connect"));
    act(() => ioMock.fire("disconnect"));

    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
    expect(result.current.transport).toBeNull();
  });

  it("reports disconnected after reconnection is exhausted", async () => {
    const { result } = renderHook(() => useSocket());

    act(() => ioMock.fireManager("reconnect_failed"));

    await waitFor(() => expect(result.current.status).toBe("disconnected"));
  });

  it("subscribes to every server -> client event exactly once", () => {
    renderHook(() => useSocket());

    for (const event of [
      "match:created",
      "match:score",
      "match:commentary",
      "match:status",
      "subscription:ack",
      "rate:limited",
    ]) {
      expect(ioMock.listeners.get(event)?.size).toBe(1);
    }
  });

  it("routes a broadcast to the latest handler closure", async () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ handler }) => useSocket({ handlers: { "match:score": handler } }), {
      initialProps: { handler: first },
    });

    // Handlers are read from a ref, so replacing them must not re-bind.
    rerender({ handler: second });
    expect(ioMock.listeners.get("match:score")?.size).toBe(1);

    act(() => ioMock.fire("match:score", { matchId: 1, homeScore: 1, awayScore: 0 }));

    expect(second).toHaveBeenCalledWith({ matchId: 1, homeScore: 1, awayScore: 0 });
    expect(first).not.toHaveBeenCalled();
  });

  it("ignores events that have no handler registered", () => {
    renderHook(() => useSocket({ handlers: {} }));
    // Must not throw.
    act(() => ioMock.fire("match:created", { id: 1 }));
  });

  it("emits join:match with a payload and an ack callback", () => {
    const { result } = renderHook(() => useSocket());

    act(() => result.current.joinMatch(7, vi.fn()));

    expect(ioMock.socket.emit).toHaveBeenCalledWith("join:match", { matchId: 7 }, expect.any(Function));
  });

  it("emits leave:match for the requested fixture", () => {
    const { result } = renderHook(() => useSocket());

    act(() => result.current.leaveMatch(7));

    expect(ioMock.socket.emit).toHaveBeenCalledWith("leave:match", { matchId: 7 }, expect.any(Function));
  });

  it("invokes the ack callback with the server payload", () => {
    const onAck = vi.fn();
    const { result } = renderHook(() => useSocket());

    act(() => result.current.joinMatch(7, onAck));

    // Simulate the server invoking the acknowledgement.
    const emitCall = ioMock.socket.emit.mock.calls.find(([event]) => event === "join:match");
    const ack = emitCall?.[2] as (payload: unknown) => void;
    act(() => ack({ matchId: 7, room: "match:7", joined: true, subscribers: 2 }));

    expect(onAck).toHaveBeenCalledWith({ matchId: 7, room: "match:7", joined: true, subscribers: 2 });
  });

  it("tolerates a missing ack callback", () => {
    const { result } = renderHook(() => useSocket());
    act(() => result.current.joinMatch(7));

    const emitCall = ioMock.socket.emit.mock.calls.find(([event]) => event === "join:match");
    const ack = emitCall?.[2] as (payload: unknown) => void;
    expect(() => act(() => ack({ matchId: 7 }))).not.toThrow();
  });

  it("does not open a socket when disabled", () => {
    const { result } = renderHook(() => useSocket({ enabled: false }));

    expect(ioMock.factory).not.toHaveBeenCalled();
    expect(result.current.status).toBe("disconnected");
  });

  it("disconnects and unbinds on unmount", () => {
    const { unmount } = renderHook(() => useSocket());
    unmount();

    expect(ioMock.socket.disconnect).toHaveBeenCalled();
    expect(ioMock.listeners.size).toBe(0);
  });

  it("exposes a development-only test handle", () => {
    renderHook(() => useSocket());

    const handle = (window as unknown as { __sportz?: { disconnect: () => void; connect: () => void } })
      .__sportz;
    expect(handle).toBeTruthy();

    act(() => handle!.disconnect());
    expect(ioMock.socket.disconnect).toHaveBeenCalled();
  });
});
