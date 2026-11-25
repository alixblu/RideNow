import { useCallback, useEffect, useRef, useState } from "react";
import type { Geocoder, Place } from "./contract";

export const DEBOUNCE_MS = 800;
export const MIN_REQUEST_INTERVAL_MS = 1000;
export const MIN_QUERY_LENGTH = 3;
export const MAX_SUGGESTIONS = 5;

export type GeocoderStatus = "not-configured" | "idle" | "loading" | "results" | "empty" | "error";

export interface DebouncedGeocoder {
  status: GeocoderStatus;
  suggestions: Place[];
  /** Call on every text change. Queries under 3 characters cancel and reset to idle. */
  search(query: string): void;
  /** Re-runs the last query immediately (still subject to the 1 request per second ceiling). */
  retry(): void;
  /** Cancels pending and in-flight work and clears suggestions. */
  reset(): void;
}

/**
 * Debounced, rate-limited, cancellable wrapper around a Geocoder.
 * A null geocoder yields the "not-configured" status and never issues requests.
 */
export function useDebouncedGeocoder(geocoder: Geocoder | null): DebouncedGeocoder {
  const [state, setState] = useState<{ status: GeocoderStatus; suggestions: Place[] }>({
    status: geocoder ? "idle" : "not-configured",
    suggestions: [],
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lastStart = useRef<number | null>(null);
  const lastQuery = useRef("");
  const geocoderRef = useRef(geocoder);
  geocoderRef.current = geocoder;

  const cancelWork = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
    }
  }, []);

  const run = useCallback((query: string, delayMs: number) => {
    const g = geocoderRef.current;
    if (!g) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const sinceLast = lastStart.current === null ? Infinity : Date.now() - lastStart.current;
      if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
        run(query, MIN_REQUEST_INTERVAL_MS - sinceLast);
        return;
      }
      lastStart.current = Date.now();
      const ctl = new AbortController();
      controller.current = ctl;
      g.search(query, ctl.signal).then(
        (places) => {
          if (ctl.signal.aborted) return;
          controller.current = null;
          const suggestions = places.slice(0, MAX_SUGGESTIONS);
          setState({ status: suggestions.length > 0 ? "results" : "empty", suggestions });
        },
        () => {
          if (ctl.signal.aborted) return;
          controller.current = null;
          setState({ status: "error", suggestions: [] });
        },
      );
    }, delayMs);
  }, []);

  const search = useCallback(
    (query: string) => {
      cancelWork();
      const q = query.trim();
      lastQuery.current = q;
      if (!geocoderRef.current) {
        setState({ status: "not-configured", suggestions: [] });
        return;
      }
      if (q.length < MIN_QUERY_LENGTH) {
        setState({ status: "idle", suggestions: [] });
        return;
      }
      setState((s) => ({ status: "loading", suggestions: s.suggestions }));
      run(q, DEBOUNCE_MS);
    },
    [cancelWork, run],
  );

  const retry = useCallback(() => {
    const q = lastQuery.current;
    if (!geocoderRef.current || q.length < MIN_QUERY_LENGTH) return;
    cancelWork();
    setState((s) => ({ status: "loading", suggestions: s.suggestions }));
    run(q, 0);
  }, [cancelWork, run]);

  const reset = useCallback(() => {
    cancelWork();
    lastQuery.current = "";
    setState({ status: geocoderRef.current ? "idle" : "not-configured", suggestions: [] });
  }, [cancelWork]);

  useEffect(() => cancelWork, [cancelWork]);

  return { status: geocoder ? state.status : "not-configured", suggestions: state.suggestions, search, retry, reset };
}
