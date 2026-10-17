/**
 * Toast system — lightweight, dependency-free notifications.
 *
 * `ToastProvider` holds the active toasts and renders them in a fixed stack;
 * `useToast()` returns `{ toast }` for screens to push success/error messages. Toasts
 * auto-dismiss after a timeout and can be dismissed manually. Mounted once near the
 * app root (inside App).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CheckCircle2, X, AlertCircle, Info } from "lucide-react";
import { cn } from "./cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const TONE_ACCENT: Record<ToastTone, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, tone, message }]);
      // Auto-dismiss after 4s.
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border",
                "bg-surface-raised px-4 py-3 shadow-pop animate-slide-up",
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", TONE_ACCENT[item.tone])} aria-hidden="true" />
              <p className="flex-1 text-sm text-content">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="shrink-0 text-content-subtle hover:text-content"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Falls back to a no-op if no provider is mounted (e.g. in a
 *  unit test that renders a screen in isolation), so screens can call it safely. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    return { toast: () => {} };
  }
  return ctx;
}
