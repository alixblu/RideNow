/**
 * UserDirectory — the Admin_Console PRIMARY surface: browse users and open one.
 *
 * Lists users from the live list endpoint via TanStack Query
 * (`useQuery(['users'], () => listUsers({}))`) and renders them as a selectable table
 * (full name, email, status, created date). Selecting a row opens that user's full
 * record through the shared `UserDetail` — the primary path is browse-and-open, not
 * type-an-id. The detail is driven by the already-loaded row data, so opening a user
 * is instant and needs no second request.
 *
 * Cross-cutting states follow the shared contract: a `Loading` indicator while pending
 * (Req 13.1), an `EmptyState` when the directory is empty, and `Unavailable` + Retry
 * when the list endpoint is unreachable (ApiError.UNAVAILABLE, Req 13.3); any other
 * sanitized failure shows through `ErrorBanner` (Req 13.2).
 *
 * Confined to list + get only (Req 8.5, 12.4) — no update or delete surfaces.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { resolveUserClient } from "../../domain/user";
import type { Page, UserResponse } from "../../domain/user";
import { appConfig } from "../../config/appConfig";
import { ApiError } from "../../http/ApiError";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Loading,
  StatusPill,
  Unavailable,
  cn,
} from "../../shared/ui";
import { UserDetail } from "./UserDetail";

/** Render an ISO-8601 timestamp readably, falling back to the raw string. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export function UserDirectory() {
  const client = useMemo(() => resolveUserClient(appConfig), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery<Page<UserResponse>, Error>({
    queryKey: ["users"],
    queryFn: () => client.listUsers({}),
  });

  const users = useMemo(() => query.data?.items ?? [], [query.data]);
  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId],
  );

  const isUnavailable =
    query.isError && query.error instanceof ApiError && query.error.code === "UNAVAILABLE";

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
        </CardHeader>
        <CardBody>
          {query.isPending ? (
            <Loading label="Loading users…" />
          ) : isUnavailable ? (
            <Unavailable onRetry={() => void query.refetch()} message={query.error.message} />
          ) : query.isError ? (
            <ErrorBanner
              message={
                query.error instanceof ApiError
                  ? query.error.message
                  : "Something went wrong loading users."
              }
            />
          ) : users.length === 0 ? (
            <EmptyState message="No accounts yet. Create one to get started." />
          ) : (
            <table className="w-full text-sm" aria-label="Users">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-content-subtle">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Created</th>
                  <th className="pb-2 w-6" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelected = user.id === selectedId;
                  return (
                    <tr
                      key={user.id}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setSelectedId(user.id)}
                      className={cn(
                        "cursor-pointer border-b border-border/60 transition-colors last:border-0",
                        isSelected ? "bg-surface-raised" : "hover:bg-surface-raised",
                      )}
                    >
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(user.id)}
                          className="text-left font-medium text-content"
                        >
                          {user.fullName}
                        </button>
                      </td>
                      <td className="py-3 pr-3 text-content-muted">{user.email}</td>
                      <td className="py-3 pr-3">
                        <StatusPill status={user.status} />
                      </td>
                      <td className="py-3 pr-3 text-content-subtle">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="py-3">
                        <ChevronRight
                          className="h-4 w-4 text-content-subtle"
                          aria-hidden="true"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody>
            {selected !== null ? (
              <UserDetail user={selected} />
            ) : (
              <p className="text-sm text-content-muted">
                Select an account to see the full record.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
