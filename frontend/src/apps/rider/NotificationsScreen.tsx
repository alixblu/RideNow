/**
 * NotificationsScreen — rider notifications view (Req 12.1, 12.2).
 *
 * Lists the notifications addressed to the rider Current_Identity, rendering each
 * entry's message and timestamp (Req 12.1). When the identity has no notifications, the
 * shared `EmptyState` is shown instead of an empty list (Req 12.2).
 *
 * The recipient is the rider Current_Identity id, so no id field is needed here.
 * Restyled as a clean feed on the Tailwind kit.
 */
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { resolveNotificationClient } from "../../domain/notification";
import type { NotificationResponse } from "../../domain/notification";
import { appConfig } from "../../config/appConfig";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Loading,
} from "../../shared/ui";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { errorView } from "./shared";

const notificationClient = resolveNotificationClient(appConfig);

export function NotificationsScreen() {
  const identity = useCurrentIdentity();
  const recipientId = identity.current("rider")?.id ?? "";

  const query = useQuery<NotificationResponse[], Error>({
    queryKey: ["notifications", recipientId],
    queryFn: () => notificationClient.listForIdentity(recipientId),
    enabled: recipientId.length > 0,
  });

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardBody>
        {query.isPending ? (
          <Loading label="Loading notifications…" />
        ) : query.isError ? (
          errorView(query.error, () => void query.refetch())
        ) : query.data && query.data.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Notifications">
            {query.data.map((notification) => (
              <li
                key={notification.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Bell className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm text-content">{notification.message}</p>
                  <p className="mt-0.5 text-xs text-content-subtle">
                    <time dateTime={notification.createdAt}>
                      {formatTimestamp(notification.createdAt)}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="You have no notifications yet." />
        )}
      </CardBody>
    </Card>
  );
}

/** Render an ISO-8601 timestamp readably, falling back to the raw string. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
