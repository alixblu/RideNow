/**
 * MatchingScreen — rider matching view (Req 10.1, 10.2).
 *
 * Reads the match state for a trip from the matching client. While the match is in
 * progress the client reports SEARCHING with no assigned driver, and this screen shows
 * a matching-in-progress view with a pulsing radar animation (Req 10.1). Once matching
 * resolves, the client reports DRIVER_ASSIGNED with an assigned-driver summary, and this
 * screen renders that driver card alongside the DRIVER_ASSIGNED status (Req 10.2).
 *
 * A trip id is required; it defaults to the active trip shared with the trip screen and
 * can be overridden with a direct lookup. There is no live-location/map UI.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radar, UserCheck } from "lucide-react";
import { resolveMatchingClient } from "../../domain/matching";
import type { MatchResult } from "../../domain/matching";
import { appConfig } from "../../config/appConfig";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Loading,
  StatusPill,
} from "../../shared/ui";
import { errorView } from "./shared";

const matchingClient = resolveMatchingClient(appConfig);

interface MatchingScreenProps {
  activeTripId: string | null;
}

export function MatchingScreen({ activeTripId }: MatchingScreenProps) {
  const [tripId, setTripId] = useState(activeTripId ?? "");
  const [submittedId, setSubmittedId] = useState<string | null>(activeTripId);

  const matchQuery = useQuery<MatchResult, Error>({
    queryKey: ["match", submittedId],
    queryFn: () => matchingClient.getMatchState(submittedId as string),
    enabled: submittedId !== null && submittedId.length > 0,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = tripId.trim();
    setSubmittedId(trimmed.length > 0 ? trimmed : null);
  }

  const match = matchQuery.data ?? null;
  const searching = match !== null && match.status === "SEARCHING";

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Matching</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex items-end gap-2" onSubmit={handleSubmit} aria-label="Check matching">
          <Field htmlFor="match-trip-id" label="Trip ID" className="flex-1">
            <Input
              id="match-trip-id"
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              placeholder="Trip ID to match"
            />
          </Field>
          <Button type="submit" variant="secondary">
            Check
          </Button>
          {match !== null ? (
            <Button type="button" variant="ghost" onClick={() => void matchQuery.refetch()}>
              Refresh
            </Button>
          ) : null}
        </form>

        <div className="mt-5">
          {submittedId === null || submittedId.length === 0 ? (
            <p className="text-sm text-content-subtle">
              Enter a trip ID to view its matching state.
            </p>
          ) : matchQuery.isPending ? (
            <Loading label="Loading matching state…" />
          ) : matchQuery.isError ? (
            errorView(matchQuery.error, () => void matchQuery.refetch())
          ) : match !== null ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <StatusPill status={match.status} />

              {searching ? (
                <div className="flex flex-col items-center gap-4 py-4" role="status" aria-live="polite">
                  <span className="relative flex h-16 w-16 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-accent/30 animate-pulse-ring" />
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <Radar className="h-6 w-6" aria-hidden="true" />
                    </span>
                  </span>
                  <p className="text-sm text-content-muted">
                    Searching for a nearby driver… Use Refresh to check again.
                  </p>
                </div>
              ) : match.assignedDriver !== null ? (
                <div className="w-full rounded-2xl border border-border bg-surface-raised p-4 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
                      <UserCheck className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-content">Driver assigned</p>
                      <p className="text-xs text-content-muted">{match.assignedDriver.summary}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-content-subtle">Driver</dt>
                      <dd className="break-all">{match.assignedDriver.driverId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle">Vehicle</dt>
                      <dd className="break-all">{match.assignedDriver.vehicleId}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
