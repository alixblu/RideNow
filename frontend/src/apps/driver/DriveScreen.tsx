/**
 * DriveScreen — the Driver_App's Drive destination (Req 5.2, 5.5, 5.6).
 *
 * A full-bleed map with an online/offline switch, and a bottom sheet that shows either
 * a trip offer (accept / decline), or the accepted trip with one primary lifecycle
 * button. Logic moved from the legacy TripDesk; position sending stays on
 * `useLocationSender`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverServiceClient } from "../../domain/driver";
import { resolveTripClient } from "../../domain/trip";
import type { TripResponse, TripServiceClientExt } from "../../domain/trip/contract";
import { MapCanvas } from "../../map/MapCanvas";
import { createRoadSnapper } from "../../map/roadSnapper";
import type { LatLng, RoadSnapper } from "../../map/roadSnapper";
import { ApiError } from "../../http/ApiError";
import { driverNextAction } from "./nextAction";
import type { DriverAction } from "./nextAction";
import { friendlyError } from "../../shared/errors";
import { formatDistance, formatVnd } from "../../shared/format";
import { Badge, BottomSheet, Button, Skeleton, cn, useToast } from "../../shared/ui";
import { tripView } from "../rider/tripView";
import { densify, useLocationSender } from "./useLocationSender";
import type { LocationSource } from "./useLocationSender";
import { useDriver } from "./DriverContext";
import { useOnlineToggle } from "./useOnlineToggle";
import { SimulationControl } from "./simulation/SimulationControl";
import { selectLocationSource } from "./simulation/locationSource";
import { hasAssignedTrip, useSimulator } from "./simulation/useSimulator";

export { selectLocationSource };

/** Where a simulated drive starts when there is no trip yet (near Ben Thanh Market). */
const START: LatLng = { lat: 10.7745, lng: 106.6955 };

/** Offer list refresh period (Req 10.4). */
const OFFER_POLL_MS = 5000;
/** Location post period (Req 10.8). */
const LOCATION_POST_MS = 3000;

interface DriveScreenProps {
  client?: DriverServiceClient;
  tripClient?: TripServiceClientExt;
  snapper?: RoadSnapper | undefined;
  geolocation?: Geolocation | undefined;
  intervalMs?: number | undefined;
}

function place(address: string | null, lat: number, lng: number): string {
  return address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export function DriveScreen({ client, tripClient, snapper, geolocation, intervalMs }: DriveScreenProps) {
  const driverClient = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const trips = useMemo(() => tripClient ?? resolveTripClient(appConfig), [tripClient]);
  const roads = useMemo(() => snapper ?? createRoadSnapper(appConfig.osrmUrl), [snapper]);
  const driverId = useDriver().id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { online, pending, toggle } = useOnlineToggle(driverId, driverClient);
  const [source, setSource] = useState<LocationSource>("gps");
  const [tripId, setTripId] = useState<string | null>(null);
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set());
  const [route, setRoute] = useState<LatLng[]>([START]);
  const lastSent = useRef<LatLng>(START);

  const tripQuery = useQuery({
    queryKey: ["drive-trip", tripId],
    enabled: tripId !== null,
    queryFn: () => trips.getTrip(tripId!),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "COMPLETED" || status === "CANCELLED" ? false : 3000;
    },
  });
  const trip = tripId !== null ? (tripQuery.data ?? null) : null;
  const view = trip ? tripView(trip.status) : null;
  const next = trip ? driverNextAction(trip.status) : null;

  const offersQuery = useQuery({
    queryKey: ["drive-offers"],
    enabled: online && tripId === null,
    queryFn: () => trips.listTrips({ status: "SEARCHING" }),
    refetchInterval: OFFER_POLL_MS,
  });
  const offers: TripResponse[] =
    tripId === null && online ? (offersQuery.data?.items ?? []).filter((t) => !declined.has(t.id)) : [];
  const offer: TripResponse | null = offers[0] ?? null;

  // Req 10.10: a finished or cancelled trip returns the driver to the offer list.
  useEffect(() => {
    if (trip && (trip.status === "COMPLETED" || trip.status === "CANCELLED")) {
      setTripId(null);
      void queryClient.invalidateQueries({ queryKey: ["drive-offers"] });
    }
  }, [trip, queryClient]);

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

  const assigned = hasAssignedTrip(trip?.status);
  const simulator = useSimulator({
    driverClient,
    driverId,
    tripStatus: trip?.status ?? null,
    pickup: trip ? { lat: trip.pickupLat, lng: trip.pickupLng } : null,
    destination: trip ? { lat: trip.destinationLat, lng: trip.destinationLng } : null,
    lastKnownPosition: lastSent.current,
    snapper: roads,
    speedKmh: appConfig.simSpeedKmh,
  });
  const simulating = simulator.running || simulator.paused;
  // Requirement 11.6: simulate while running/paused, otherwise GPS (or the denied fallback).
  const locationSource: LocationSource = simulating ? selectLocationSource(simulator.state.state) : source;

  useLocationSender({
    online,
    source: locationSource,
    route,
    intervalMs: intervalMs ?? LOCATION_POST_MS,
    geolocation,
    onDenied: () => setSource("simulate"),
    send: (point) => {
      // While simulating, the Simulator posts its own path; don't double-post.
      if (simulating) return;
      lastSent.current = point;
      void driverClient.updateLocation(driverId, point.lat, point.lng).catch(() => {
        // Loss-tolerant: the next position replaces this one.
      });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => trips.acceptTrip(id, driverId),
    onSuccess: (accepted) => {
      queryClient.setQueryData(["drive-trip", accepted.id], accepted);
      setTripId(accepted.id);
      void queryClient.invalidateQueries({ queryKey: ["drive-offers"] });
    },
    onError: (error, id) => {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        toast("Another driver took this trip.", "error");
        setDeclined((prev) => new Set(prev).add(id));
      } else {
        toast(friendlyError(error), "error");
      }
      void queryClient.invalidateQueries({ queryKey: ["drive-offers"] });
    },
  });

  const actionMutation = useMutation({
    mutationFn: (action: DriverAction) =>
      action === "arrive"
        ? trips.arriveTrip(tripId!)
        : action === "start"
          ? trips.startTrip(tripId!)
          : trips.completeTrip(tripId!),
    onSuccess: (updated) => {
      queryClient.setQueryData(["drive-trip", updated.id], updated);
    },
    onError: (error) => toast(friendlyError(error), "error"),
  });

  const mapPoints = trip ?? offer;
  const pickup = mapPoints ? { lat: mapPoints.pickupLat, lng: mapPoints.pickupLng } : null;
  const destination = mapPoints ? { lat: mapPoints.destinationLat, lng: mapPoints.destinationLng } : null;

  return (
    <div className="relative h-full w-full">
      <MapCanvas pickup={pickup} destination={destination} trip={trip && view?.showDriverMarker ? trip : null} />

      <div className="absolute left-4 top-4 z-20">
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label="Online"
          disabled={pending || driverId === ""}
          onClick={() => void toggle()}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold shadow-sheet transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
            online ? "bg-accent text-accent-fg" : "bg-surface text-content",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-block h-6 w-11 rounded-full transition-colors",
              online ? "bg-accent-fg/30" : "bg-border",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all",
                online ? "left-[22px]" : "left-0.5",
              )}
            />
          </span>
          {online ? "You're online" : "You're offline"}
        </button>
      </div>

      <BottomSheet label="Drive" defaultSnap="half">
        {trip && view ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Current trip</h2>
              <Badge status={trip.status} />
            </div>
            <Route trip={trip} />
            {assigned ? <SimulationControl simulator={simulator} hasAssignedTrip={assigned} /> : null}
            {next ? (
              <Button
                size="lg"
                block
                loading={actionMutation.isPending}
                onClick={() => actionMutation.mutate(next.action)}
              >
                {next.label}
              </Button>
            ) : null}
          </div>
        ) : offers.length > 0 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Trip offers</h2>
            {offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                trips={trips}
                accepting={acceptMutation.isPending && acceptMutation.variables === o.id}
                onAccept={() => acceptMutation.mutate(o.id)}
                onDecline={() => setDeclined((prev) => new Set(prev).add(o.id))}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-2">
            <h2 className="text-lg font-semibold">{online ? "Looking for trips" : "You're offline"}</h2>
            <p className="text-sm text-content-muted">
              {online ? "New trip offers will appear here." : "Go online to start receiving trip offers."}
            </p>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

interface OfferCardProps {
  offer: TripResponse;
  trips: TripServiceClientExt;
  accepting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

function OfferCard({ offer, trips, accepting, onAccept, onDecline }: OfferCardProps) {
  const fareQuery = useQuery({
    queryKey: ["drive-offer-fare", offer.id],
    queryFn: async () => {
      const fares = await trips.estimateFares({
        pickupLat: offer.pickupLat,
        pickupLng: offer.pickupLng,
        destinationLat: offer.destinationLat,
        destinationLng: offer.destinationLng,
      });
      return fares.find((f) => f.vehicleType === offer.rideType) ?? null;
    },
  });
  return (
    <div className="flex flex-col gap-3" aria-label="Trip offer">
      <Route trip={offer} />
      {fareQuery.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : fareQuery.data ? (
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-content-muted">Estimated fare</dt>
            <dd className="text-xl font-bold">{formatVnd(fareQuery.data.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted">Distance</dt>
            <dd className="text-xl font-bold">{formatDistance(fareQuery.data.distanceKm)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-content-muted">Fare estimate unavailable.</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant="secondary" onClick={onDecline}>
          Decline
        </Button>
        <Button size="lg" loading={accepting} onClick={onAccept}>
          Accept
        </Button>
      </div>
    </div>
  );
}

function Route({ trip }: { trip: TripResponse }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      <li>
        <span className="text-xs text-content-muted">Pickup</span>
        <p className="font-medium">{place(trip.pickupAddress, trip.pickupLat, trip.pickupLng)}</p>
      </li>
      <li>
        <span className="text-xs text-content-muted">Destination</span>
        <p className="font-medium">{place(trip.destinationAddress, trip.destinationLat, trip.destinationLng)}</p>
      </li>
    </ul>
  );
}
