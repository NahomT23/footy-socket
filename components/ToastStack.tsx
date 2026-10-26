"use client";

import { useToast, type Toast } from "@/hooks/useToast";

/**
 * Bottom-right toast stack. Used for "new match scheduled" announcements, and
 * for surfacing server-side rate-limit rejections.
 */
export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`toast-enter brutal pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3 ${
            toast.tone === "error" ? "bg-danger text-white" : "bg-accent text-ink"
          }`}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            {toast.tone === "error" ? "⚠️" : "📣"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-wide">{toast.title}</p>
            {toast.description && <p className="mt-0.5 text-xs font-medium break-words">{toast.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="brutal-sm shrink-0 bg-white px-1.5 text-xs font-black text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export { useToast };
export type { Toast };
