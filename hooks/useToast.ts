"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: "info" | "error";
}

export interface UseToastResult {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

/** Small queue with auto-dismiss; `tone` drives the accent colour. */
export function useToast(timeoutMs = 6_000): UseToastResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;

      // Keep the stack short so it never covers the dashboard.
      setToasts((previous) => [...previous.slice(-2), { ...toast, id }]);

      timersRef.current.set(id, window.setTimeout(() => dismiss(id), timeoutMs));
    },
    [dismiss, timeoutMs]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
