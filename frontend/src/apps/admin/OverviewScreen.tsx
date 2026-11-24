/** OverviewScreen — four summary stat cards (Req 6.2). */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { appConfig } from "../../config/appConfig";
import { resolveAdminClient } from "../../domain/admin";
import type { AdminOverview } from "../../domain/admin";
import { formatVnd } from "../../shared/format";
import { Card, ErrorState, Skeleton } from "../../shared/ui";

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-5" data-testid="stat-card">
      <p className="text-sm font-medium text-content-muted">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-content">{value}</p>
    </Card>
  );
}

export function OverviewScreen() {
  const client = useMemo(() => resolveAdminClient(appConfig), []);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setError(null);
    client.getOverview().then(
      (o) => {
        if (!cancelled) setOverview(o);
      },
      (e: unknown) => {
        if (!cancelled) setError(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-6">
      <h1 id="overview-heading" className="text-2xl font-extrabold">
        Overview
      </h1>
      {error !== null ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview === null ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <StatCard label="Active trips" value={overview.activeTrips} />
              <StatCard label="Online drivers" value={overview.onlineDrivers} />
              <StatCard label="Completed today" value={overview.completedToday} />
              <StatCard label="Revenue today" value={formatVnd(overview.revenueToday)} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
