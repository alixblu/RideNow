/**
 * useNotifications — the inbox, by polling (see docs/REALTIME.md).
 *
 *  - Polls `listSince(userId, lastId)` every `intervalMs` (3s for riders, 2s for drivers).
 *  - Pauses while the tab is hidden and refetches on focus (TanStack Query's
 *    `refetchIntervalInBackground: false` and `refetchOnWindowFocus`).
 *  - Backs off on errors: the interval doubles per consecutive failure, up to 30s.
 *  - Calls `onNew` once per new item, deduplicated by id. The first load is history
 *    and is not announced.
 */
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NotificationResponse, NotificationServiceClient } from "../domain/notification";

export const MAX_BACKOFF_MS = 30_000;

export interface UseNotificationsOptions {
  client: NotificationServiceClient;
  /** Poll interval while healthy. */
  intervalMs?: number | undefined;
  /** Called once for each item that arrives after the first load. */
  onNew?: ((item: NotificationResponse) => void) | undefined;
}

export interface UseNotificationsResult {
  items: NotificationResponse[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  isError: boolean;
}

/** The next poll delay: the base interval, doubled per consecutive failure, capped. */
export function pollDelay(intervalMs: number, consecutiveFailures: number): number {
  return Math.min(intervalMs * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
}

export function useNotifications(
  userId: string,
  { client, intervalMs = 3000, onNew }: UseNotificationsOptions,
): UseNotificationsResult {
  const [items, setItems] = useState<NotificationResponse[]>([]);
  const seen = useRef(new Set<string>());
  const lastId = useRef<string | undefined>(undefined);
  const loadedOnce = useRef(false);
  const failures = useRef(0);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const query = useQuery({
    queryKey: ["notifications", userId],
    enabled: userId.length > 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: () => pollDelay(intervalMs, failures.current),
    queryFn: async () => {
      let batch: NotificationResponse[];
      try {
        batch = await client.listSince(userId, lastId.current);
        failures.current = 0;
      } catch (error) {
        failures.current += 1;
        throw error;
      }
      const fresh = batch.filter((n) => !seen.current.has(n.id));
      fresh.forEach((n) => seen.current.add(n.id));
      if (batch.length > 0) {
        lastId.current = batch[batch.length - 1]!.id;
      }
      if (fresh.length > 0) {
        setItems((prev) => [...prev, ...fresh]);
        if (loadedOnce.current) {
          fresh.forEach((n) => onNewRef.current?.(n));
        }
      }
      loadedOnce.current = true;
      return batch.length;
    },
  });

  const markRead = useCallback(
    async (id: string) => {
      const updated = await client.markRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
    },
    [client],
  );

  return {
    items,
    unreadCount: items.filter((n) => n.readAt === null).length,
    markRead,
    isError: query.isError,
  };
}
