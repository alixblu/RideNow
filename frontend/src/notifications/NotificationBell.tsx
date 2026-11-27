/**
 * NotificationBell — a bell with the unread count; it opens the inbox list, where each
 * unread item can be marked read. New items also show as toasts.
 */
import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { appConfig } from "../config/appConfig";
import { resolveNotificationClient } from "../domain/notification";
import type { NotificationServiceClient } from "../domain/notification";
import { cn, useToast } from "../shared/ui";
import { useNotifications } from "./useNotifications";

interface NotificationBellProps {
  userId: string;
  /** 3s for riders, 2s for drivers. */
  intervalMs?: number;
  /** Injected in tests; resolved from config otherwise. */
  client?: NotificationServiceClient;
}

export function NotificationBell({ userId, intervalMs = 3000, client }: NotificationBellProps) {
  const { toast } = useToast();
  const resolved = useMemo(() => client ?? resolveNotificationClient(appConfig), [client]);
  const [open, setOpen] = useState(false);
  const { items, unreadCount, markRead } = useNotifications(userId, {
    client: resolved,
    intervalMs,
    onNew: (n) => toast(n.message, "info"),
  });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-content-muted hover:text-content"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-accent px-1 text-center text-xs font-medium text-accent-fg">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Inbox"
          className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-lg"
        >
          {items.length === 0 ? (
            <p className="p-3 text-sm text-content-muted">No notifications yet.</p>
          ) : (
            <ul className="flex flex-col">
              {[...items].reverse().map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-xl p-3 text-sm",
                    n.readAt === null ? "text-content" : "text-content-subtle",
                  )}
                >
                  <div>
                    <p>{n.message}</p>
                    <p className="mt-0.5 text-xs text-content-subtle">
                      {new Date(n.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  {n.readAt === null && (
                    <button
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className="shrink-0 text-xs text-accent hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
