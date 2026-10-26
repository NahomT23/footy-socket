/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToast } from "@/hooks/useToast";

/**
 * `useToast` owns the notification queue. It uses real timers here with short
 * timeouts rather than fake timers, because React state updates need to flush
 * through `act` and fake timers make that needlessly brittle.
 */
describe("useToast", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts empty", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("pushes a toast with a generated id", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.push({ title: "New match scheduled", description: "A 0 – 0 B", tone: "info" }));

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      title: "New match scheduled",
      description: "A 0 – 0 B",
      tone: "info",
    });
    expect(typeof result.current.toasts[0].id).toBe("number");
  });

  it("assigns unique ids to successive toasts", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.push({ title: "First", tone: "info" });
      result.current.push({ title: "Second", tone: "error" });
    });

    const [first, second] = result.current.toasts;
    expect(first.id).not.toBe(second.id);
  });

  it("caps the visible stack so it cannot cover the dashboard", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      for (let index = 0; index < 6; index += 1) {
        result.current.push({ title: `Toast ${index}`, tone: "info" });
      }
    });

    expect(result.current.toasts.length).toBeLessThanOrEqual(3);
    // The newest toast is always kept.
    expect(result.current.toasts.at(-1)?.title).toBe("Toast 5");
  });

  it("dismisses a specific toast by id", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.push({ title: "Keep me", tone: "info" });
    });
    const id = result.current.toasts[0].id;

    act(() => result.current.dismiss(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it("ignores dismissal of an unknown id", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.push({ title: "Still here", tone: "info" }));
    act(() => result.current.dismiss(999_999));

    expect(result.current.toasts).toHaveLength(1);
  });

  it("auto-dismisses a toast after its timeout", async () => {
    const { result } = renderHook(() => useToast(60));

    act(() => result.current.push({ title: "Transient", tone: "info" }));
    expect(result.current.toasts).toHaveLength(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("clears a pending timer when dismissed early", async () => {
    const { result } = renderHook(() => useToast(80));

    act(() => result.current.push({ title: "Early exit", tone: "info" }));
    act(() => result.current.dismiss(result.current.toasts[0].id));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 130));
    });

    // No late state update resurrects the toast or throws.
    expect(result.current.toasts).toHaveLength(0);
  });

  it("keeps push and dismiss identities stable across renders", () => {
    const { result, rerender } = renderHook(() => useToast());
    const firstPush = result.current.push;
    const firstDismiss = result.current.dismiss;

    rerender();

    expect(result.current.push).toBe(firstPush);
    expect(result.current.dismiss).toBe(firstDismiss);
  });
});
