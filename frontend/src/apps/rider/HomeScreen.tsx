/**
 * HomeScreen — the Rider booking journey on a full-bleed map with a bottom sheet.
 *
 * Plan (pick places) -> Quote (fares per vehicle type) -> Searching -> Assigned /
 * Arrived / In progress (driver card) -> Summary (1 to 5 star rating).
 * The trip is polled with `getTrip`; the driver marker streams through `MapCanvas`.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Star } from "lucide-react";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import { resolveTripClient } from "../../domain/trip";
import type { CreateTripRequest, TripResponse } from "../../domain/trip";
import type { FareEstimate } from "../../domain/trip/contract";
import { PRESET_LOCATIONS } from "../../domain/seed/places";
import type { PresetLocation } from "../../domain/seed/places";
import { mockProfiles } from "../../identity/mockProfiles";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { MapCanvas } from "../../map/MapCanvas";
import { friendlyError } from "../../shared/errors";
import { formatDistance, formatDuration, formatVnd } from "../../shared/format";
import type { VehicleType } from "../../shared/enums";
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  ErrorState,
  Field,
  Select,
  Skeleton,
  cn,
  useToast,
} from "../../shared/ui";
import { PayPalCheckout } from "./PayPalCheckout";
import { tripView } from "./tripView";

const tripClient = resolveTripClient(appConfig);
const driverClient = resolveDriverClient(appConfig);

const POLL_MS = 3000;
const VEHICLE_LABEL: Record<VehicleType, string> = { MOTORBIKE: "Motorbike", CAR: "Car" };

function isTerminalStatus(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

function findPlace(id: string): PresetLocation | null {
  return PRESET_LOCATIONS.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Fare quotes
// ---------------------------------------------------------------------------

/** One quote per vehicle type, each showing price, duration and distance. */
export function QuoteList({
  estimates,
  selected,
  onSelect,
}: {
  estimates: readonly FareEstimate[];
  selected: VehicleType;
  onSelect: (type: VehicleType) => void;
}) {
  return (
    <ul aria-label="Fare quotes" className="flex flex-col gap-2">
      {estimates.map((estimate) => {
        const active = estimate.vehicleType === selected;
        return (
          <li key={estimate.vehicleType}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(estimate.vehicleType)}
              className={cn(
                "flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors",
                active ? "border-accent bg-surface-raised" : "border-transparent bg-surface-raised",
              )}
            >
              <span className="flex items-center gap-3">
                <Car className="h-5 w-5" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{VEHICLE_LABEL[estimate.vehicleType]}</span>
                  <span className="text-xs text-content-muted">
                    {formatDuration(estimate.durationMin)} · {formatDistance(estimate.distanceKm)}
                  </span>
                </span>
              </span>
              <span className="text-base font-bold">{formatVnd(estimate.amount)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function QuoteSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading fares" role="status">
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

function StarRating({
  value,
  disabled,
  onRate,
}: {
  value: number | null;
  disabled: boolean;
  onRate: (stars: 1 | 2 | 3 | 4 | 5) => void;
}) {
  const stars = [1, 2, 3, 4, 5] as const;
  return (
    <div role="group" aria-label="Rate your ride" className="flex justify-center gap-1">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
          aria-pressed={value !== null && n <= value}
          onClick={() => onRate(n)}
          className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-60"
        >
          <Star
            className={cn("h-8 w-8", value !== null && n <= value ? "fill-warning text-warning" : "text-content-subtle")}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver card
// ---------------------------------------------------------------------------

function DriverCard({ trip }: { trip: TripResponse }) {
  const profile = mockProfiles.driver.find((p) => p.userId === trip.driverId) ?? null;
  const name = profile?.name ?? "Your driver";
  const vehicle = profile?.vehicle ? `${profile.vehicle.model}, ${profile.vehicle.plate}` : null;
  const driverId = trip.driverId;

  const ratingQuery = useQuery({
    queryKey: ["driver-rating", driverId],
    queryFn: () => driverClient.getDriverRating(driverId ?? ""),
    enabled: driverId !== null,
    retry: false,
  });

  const phase = tripView(trip.status).riderPhase;
  const headline =
    phase === "arrived" ? "Your driver has arrived" : phase === "in-progress" ? "On the way to your destination" : "Your driver is on the way";

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-raised p-4" aria-label="Driver">
      <Avatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-content-muted">{headline}</p>
        <p className="truncate text-base font-bold">{name}</p>
        <p className="flex items-center gap-1 text-sm text-content-muted">
          <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
          {ratingQuery.isPending ? (
            <Skeleton className="inline-block h-4 w-8" />
          ) : ratingQuery.data ? (
            <span>{ratingQuery.data.average.toFixed(1)}</span>
          ) : (
            <span>New</span>
          )}
        </p>
        {vehicle ? <p className="truncate text-sm">{vehicle}</p> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function HomeScreen() {
  const identity = useCurrentIdentity();
  const riderId = identity.current("rider")?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pickupId, setPickupId] = useState<string>(PRESET_LOCATIONS[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState<string>("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("MOTORBIKE");
  const [tripId, setTripId] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [payWith, setPayWith] = useState<"CASH" | "PAYPAL">("CASH");

  const pickup = findPlace(pickupId);
  const destination = findPlace(destinationId);
  const routeReady = pickup !== null && destination !== null && pickup.id !== destination.id;

  const estimatesQuery = useQuery<FareEstimate[], Error>({
    queryKey: ["fare-estimates", pickupId, destinationId],
    queryFn: () =>
      tripClient.estimateFares({
        pickupLat: pickup?.lat ?? 0,
        pickupLng: pickup?.lng ?? 0,
        destinationLat: destination?.lat ?? 0,
        destinationLng: destination?.lng ?? 0,
      }),
    enabled: routeReady && tripId === null,
    retry: false,
  });

  const tripQuery = useQuery<TripResponse, Error>({
    queryKey: ["trip", tripId],
    queryFn: () => tripClient.getTrip(tripId ?? ""),
    enabled: tripId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalStatus(status) ? false : POLL_MS;
    },
  });

  const requestMutation = useMutation<TripResponse, Error, CreateTripRequest>({
    mutationFn: (req) => tripClient.requestTrip(req),
    onSuccess: (trip) => {
      setTripId(trip.id);
      setRating(null);
      queryClient.setQueryData(["trip", trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ["rider-history", riderId] });
    },
    onError: (err) => toast(friendlyError(err), "error"),
  });

  const cancelMutation = useMutation<TripResponse, Error, string>({
    mutationFn: (id) => tripClient.cancelTrip(id),
    onSuccess: (trip) => {
      queryClient.setQueryData(["trip", trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ["rider-history", riderId] });
    },
    onError: (err) => {
      toast(friendlyError(err), "error");
      void tripQuery.refetch();
    },
  });

  const rateMutation = useMutation<void, Error, 1 | 2 | 3 | 4 | 5>({
    mutationFn: (stars) => tripClient.rateTrip(tripId ?? "", stars),
    onSuccess: (_void, stars) => {
      setRating(stars);
      void queryClient.invalidateQueries({ queryKey: ["rider-history", riderId] });
    },
    onError: (err) => toast(friendlyError(err), "error"),
  });

  function resetJourney() {
    setTripId(null);
    setRating(null);
    setDestinationId("");
  }

  function confirm(paypalOrderId?: string) {
    if (!pickup || !destination) return;
    requestMutation.mutate({
      passengerId: riderId,
      rideType: vehicleType,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      paymentMethod: payWith,
      ...(paypalOrderId ? { paypalOrderId } : {}),
    });
  }

  const selectedQuote = estimatesQuery.data?.find((e) => e.vehicleType === vehicleType) ?? null;
  const trip = tripQuery.data ?? null;
  const view = trip ? tripView(trip.status) : null;

  const mapPickup = trip ? { lat: trip.pickupLat, lng: trip.pickupLng } : pickup;
  const mapDestination = trip ? { lat: trip.destinationLat, lng: trip.destinationLng } : destination;

  let body;
  let label = "Book a ride";

  if (tripId !== null) {
    if (tripQuery.isPending) {
      label = "Your ride";
      body = (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading your ride">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      );
    } else if (tripQuery.isError || trip === null || view === null) {
      label = "Your ride";
      body = <ErrorState error={tripQuery.error} onRetry={() => void tripQuery.refetch()} />;
    } else if (view.riderPhase === "cancelled") {
      label = "Ride cancelled";
      body = (
        <div className="flex flex-col gap-4">
          <p className="text-base font-semibold">Your ride was cancelled.</p>
          <Button size="lg" block onClick={resetJourney}>
            Book another ride
          </Button>
        </div>
      );
    } else if (view.showSummary) {
      label = "Trip summary";
      const fare = trip.finalFare ?? trip.estimatedFare;
      body = (
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <p className="text-sm text-content-muted">You have arrived</p>
            <p className="text-3xl font-bold">{fare === null ? "—" : formatVnd(fare)}</p>
          </div>
          <DriverCard trip={trip} />
          <p className="text-center text-sm font-medium">How was your ride?</p>
          <StarRating value={rating} disabled={rating !== null || rateMutation.isPending} onRate={(s) => rateMutation.mutate(s)} />
          {rating !== null ? <p className="text-center text-sm text-content-muted">Thanks for rating.</p> : null}
          <Button size="lg" block onClick={resetJourney}>
            Done
          </Button>
        </div>
      );
    } else {
      label = "Your ride";
      body = (
        <div className="flex flex-col gap-4">
          {view.riderPhase === "searching" || view.riderPhase === "requested" ? (
            <div role="status" aria-live="polite" className="flex items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center">
                <span className="absolute inline-flex h-full w-full rounded-full bg-accent/30 animate-pulse-ring" />
                <Car className="relative h-5 w-5 text-accent" aria-hidden="true" />
              </span>
              <p className="text-base font-semibold">Searching for a nearby driver…</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <Badge status={trip.status} />
              {trip.estimatedFare !== null ? <span className="font-bold">{formatVnd(trip.estimatedFare)}</span> : null}
            </div>
          )}
          {view.showDriverCard ? <DriverCard trip={trip} /> : null}
          {view.showCancel ? (
            <Button variant="danger" size="lg" block loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate(trip.id)}>
              Cancel ride
            </Button>
          ) : null}
        </div>
      );
    }
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Field htmlFor="home-pickup" label="Pickup">
          <Select id="home-pickup" value={pickupId} onChange={(e) => setPickupId(e.target.value)}>
            {PRESET_LOCATIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="home-destination" label="Where to?">
          <Select id="home-destination" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">Choose a destination</option>
            {PRESET_LOCATIONS.filter((p) => p.id !== pickupId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        {routeReady ? (
          estimatesQuery.isPending ? (
            <QuoteSkeleton />
          ) : estimatesQuery.isError ? (
            <ErrorState error={estimatesQuery.error} onRetry={() => void estimatesQuery.refetch()} />
          ) : (
            <QuoteList estimates={estimatesQuery.data} selected={vehicleType} onSelect={setVehicleType} />
          )
        ) : null}

        <fieldset className="flex gap-4" aria-label="Payment method">
          {(["CASH", "PAYPAL"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="radio" name="payWith" checked={payWith === m} onChange={() => setPayWith(m)} />
              {m === "CASH" ? "Cash" : "PayPal"}
            </label>
          ))}
        </fieldset>
        {payWith === "PAYPAL" ? (
          selectedQuote && routeReady && riderId !== "" ? (
            <PayPalCheckout
              amount={selectedQuote.amount}
              onApproved={(orderId) => confirm(orderId)}
              onError={(message) => toast(message, "error")}
            />
          ) : (
            <p className="text-sm text-content-muted">Choose a destination to pay with PayPal.</p>
          )
        ) : (
          <Button
            size="lg"
            block
            disabled={!routeReady || !estimatesQuery.isSuccess || riderId === ""}
            loading={requestMutation.isPending}
            onClick={() => confirm()}
          >
            {`Confirm ${VEHICLE_LABEL[vehicleType]}`}
          </Button>
        )}
      </div>
    );
  }

  const streaming = trip !== null && view !== null && view.showDriverMarker;

  return (
    <div className="absolute inset-0">
      <MapCanvas
        pickup={mapPickup}
        destination={mapDestination}
        trip={streaming ? trip : null}
        onStreamEnded={() => void tripQuery.refetch()}
        sheetHeight={Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.55)}
      />
      <BottomSheet label={label} defaultSnap="half">
        {body}
      </BottomSheet>
    </div>
  );
}
