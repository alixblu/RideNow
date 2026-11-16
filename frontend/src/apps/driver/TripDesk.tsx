/**
 * TripDesk — lets a driver run a whole trip from the browser:
 *
 *  - an online/offline toggle (going online uses the newest active vehicle);
 *  - while online, a position every 1.5s from Geolocation, or from "simulate drive",
 *    which follows the road route (OSRM when configured, else a straight line);
 *  - the available rides, and the current trip's actions: arrive, start, complete.
 *
 * Ride offers also arrive as toasts from the inbox (the bell in the header).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverServiceClient } from "../../domain/driver";
import type { TripResponse, TripServiceClient } from "../../domain/trip";
import { ApiError } from "../../http/ApiError";
import { createRoadSnapper } from "../../map/roadSnapper";
import type { LatLng, RoadSnapper } from "../../map/roadSnapper";
import { appConfig } from "../../config/appConfig";
import { Button, Card, CardBody, CardHeader, CardTitle, ErrorBanner, StatusPill, useToast } from "../../shared/ui";
import { AvailableRides } from "./DriverRoster";
import { densify, useLocationSender } from "./useLocationSender";
import type { LocationSource } from "./useLocationSender";

/** Where a simulated drive starts when there is no trip yet (near Ben Thanh Market). */
export const SIMULATION_START: LatLng = { lat: 10.7745, lng: 106.6955 };

interface TripDeskProps {
  driverId: string;
  client: DriverServiceClient;
  tripClient: TripServiceClient;
  snapper?: RoadSnapper | undefined;
  geolocation?: Geolocation | undefined;
  intervalMs?: number | undefined;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function TripDesk({ driverId, client, tripClient, snapper, geolocation, intervalMs }: TripDeskProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roads = useMemo(() => snapper ?? createRoadSnapper(appConfig.osrmUrl), [snapper]);
  const [online, setOnline] = useState(false);
  const [source, setSource] = useState<LocationSource>("gps");
  const [denied, setDenied] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLng[]>([SIMULATION_START]);
  const lastSent = useRef<LatLng>(SIMULATION_START);

  const tripQuery = useQuery({
    queryKey: ["desk-trip", tripId],
    enabled: tripId !== null,
    queryFn: () => tripClient.getTrip(tripId!),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "COMPLETED" || status === "CANCELLED" ? false : 3000;
    },
  });
  const trip = tripId !== null ? tripQuery.data ?? null : null;

  // The simulated drive follows the trip: to the pickup, wait, then to the destination.
  const status = trip?.status ?? null;
  useEffect(() => {
    let cancelled = false;
    const set = (points: LatLng[]) => {
      if (!cancelled) setRoute(points);
    };
    if (!trip) {
      set([lastSent.current]);
    } else {
      const pickup = { lat: trip.pickupLat, lng: trip.pickupLng };
      const destination = { lat: trip.destinationLat, lng: trip.destinationLng };
      if (trip.status === "DRIVER_ASSIGNED") {
        void roads.route(lastSent.current, pickup).then((p) => set(densify(p)));
      } else if (trip.status === "DRIVER_ARRIVED") {
        set([pickup]);
      } else if (trip.status === "IN_PROGRESS") {
        void roads.route(pickup, destination).then((p) => set(densify(p)));
      } else {
        set([lastSent.current]);
      }
    }
    return () => {
      cancelled = true;
    };
    // Recompute only when the trip or its stage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, status, roads]);

  useLocationSender({
    online,
    source,
    route,
    intervalMs,
    geolocation,
    onDenied: () => setDenied(true),
    send: (point) => {
      lastSent.current = point;
      void client.updateLocation(driverId, point.lat, point.lng).catch(() => {
        // Loss-tolerant: the next position replaces this one.
      });
    },
  });

  const onlineMutation = useMutation({
    mutationFn: (next: boolean) => (next ? client.goOnline(driverId).then(() => true) : client.goOffline(driverId).then(() => false)),
    onSuccess: (next) => {
      setOnline(next);
      toast(next ? "You are online." : "You are offline.", "info");
    },
    onError: (error) => toast(message(error, "Could not change availability."), "error"),
  });

  const actionMutation = useMutation({
    mutationFn: (action: "arrive" | "start" | "complete") =>
      action === "arrive"
        ? tripClient.arriveTrip(tripId!)
        : action === "start"
          ? tripClient.startTrip(tripId!)
          : tripClient.completeTrip(tripId!),
    onSuccess: (updated: TripResponse) => {
      queryClient.setQueryData(["desk-trip", updated.id], updated);
    },
    onError: (error) => toast(message(error, "Could not update the trip."), "error"),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="flex flex-col gap-5 lg:col-span-3">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Availability</CardTitle>
            <StatusPill status={online ? "ONLINE" : "OFFLINE"} />
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Button
              variant={online ? "secondary" : "primary"}
              loading={onlineMutation.isPending}
              onClick={() => onlineMutation.mutate(!online)}
            >
              {online ? "Go offline" : "Go online"}
            </Button>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 text-content-muted">Location source</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="location-source"
                  checked={source === "gps"}
                  onChange={() => {
                    setDenied(false);
                    setSource("gps");
                  }}
                />
                Device location
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="location-source"
                  checked={source === "simulate"}
                  onChange={() => setSource("simulate")}
                />
                Simulate drive
              </label>
            </fieldset>
            {denied && source === "gps" ? (
              <div role="alert" className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
                <p>Location permission was denied, so your position is not being sent.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDenied(false);
                    setSource("simulate");
                  }}
                >
                  Simulate drive instead
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Current trip</CardTitle>
            {trip ? <StatusPill status={trip.status} /> : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {trip === null ? (
              <p className="text-sm text-content-muted">Accept a ride to start a trip.</p>
            ) : (
              <>
                <p className="break-all text-xs text-content-subtle">Trip {trip.id}</p>
                {trip.status === "DRIVER_ASSIGNED" && (
                  <Button loading={actionMutation.isPending} onClick={() => actionMutation.mutate("arrive")}>
                    Arrived at pickup
                  </Button>
                )}
                {trip.status === "DRIVER_ARRIVED" && (
                  <Button loading={actionMutation.isPending} onClick={() => actionMutation.mutate("start")}>
                    Start trip
                  </Button>
                )}
                {trip.status === "IN_PROGRESS" && (
                  <Button loading={actionMutation.isPending} onClick={() => actionMutation.mutate("complete")}>
                    Complete trip
                  </Button>
                )}
                {(trip.status === "COMPLETED" || trip.status === "CANCELLED") && (
                  <Button variant="secondary" onClick={() => setTripId(null)}>
                    Done
                  </Button>
                )}
                {actionMutation.isError ? (
                  <ErrorBanner message={message(actionMutation.error, "Could not update the trip.")} />
                ) : null}
              </>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <AvailableRides tripClient={tripClient} openedDriverId={driverId} onAccepted={(t) => setTripId(t.id)} />
      </div>
    </div>
  );
}
