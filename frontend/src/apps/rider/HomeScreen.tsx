/**
 * HomeScreen — the Rider booking journey on a full-bleed map with a bottom sheet.
 *
 * Plan (pick places) -> Quote (fares per vehicle type) -> Searching -> Assigned /
 * Arrived / In progress (driver card) -> Summary.
 * The trip is polled with `getTrip`; the driver marker streams through `MapCanvas`.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Car } from "lucide-react";
import { appConfig } from "../../config/appConfig";
import { resolveTripClient } from "../../domain/trip";
import type { CreateTripRequest, TripResponse } from "../../domain/trip";
import type { FareEstimate } from "../../domain/trip/contract";
import { createNominatimGeocoder } from "../../geocoding/nominatimGeocoder";
import { swapPlaces } from "../../geocoding/place";
import type { Place } from "../../geocoding/contract";
import { resolveDriverClient } from "../../domain/driver";
import { resolveUserClient } from "../../domain/user";
import { resolveVehicleClient } from "../../domain/vehicle";
import { resolvePaymentClient } from "../../domain/payment";
import type { StreamState } from "../../map/useDriverLocationStream";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { MapCanvas } from "../../map/MapCanvas";
import { friendlyError } from "../../shared/errors";
import { formatDistance, formatDuration, formatVnd } from "../../shared/format";
import type { PaymentMethod, VehicleType } from "../../shared/enums";
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  ErrorState,
  Skeleton,
  cn,
  useToast,
} from "../../shared/ui";
import { PayPalCheckout } from "./PayPalCheckout";
import { AddressInput } from "./AddressInput";
import {
  buildCreateTripRequest,
  findResumableTrip,
  isNoDriverTimeout,
  isTooClose,
  statusAnnouncement,
  tripView,
} from "./tripView";

const tripClient = resolveTripClient(appConfig);
const driverClient = resolveDriverClient(appConfig);
const userClient = resolveUserClient(appConfig);
const vehicleClient = resolveVehicleClient(appConfig);
const paymentClient = resolvePaymentClient(appConfig);
const geocoder = appConfig.geocoderUrl ? createNominatimGeocoder(appConfig.geocoderUrl) : null;

const POLL_MS = 3000;
const PAYMENT_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "SIMULATED_CARD", label: "Simulated card" },
  { value: "PAYPAL", label: "PayPal" },
];
const VEHICLE_LABEL: Record<VehicleType, string> = { MOTORBIKE: "Motorbike", CAR: "Car" };

function isTerminalStatus(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
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
              <span className="flex flex-col items-end">
                <span className="text-base font-bold">{formatVnd(estimate.amount)}</span>
                <span className="text-xs text-content-muted">Estimated fare</span>
              </span>
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
// Driver card
// ---------------------------------------------------------------------------

function DriverCard({ trip }: { trip: TripResponse }) {
  const driverId = trip.driverId;
  const vehicleId = trip.vehicleId;
  const driverQuery = useQuery({
    queryKey: ["trip-driver", driverId],
    queryFn: async () => {
      const driver = await driverClient.getDriver(driverId ?? "");
      const user = await userClient.getUser(driver.userId);
      return user.fullName;
    },
    enabled: driverId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const vehicleQuery = useQuery({
    queryKey: ["trip-vehicle", driverId, vehicleId],
    queryFn: async () => {
      if (vehicleId) return vehicleClient.getVehicle(vehicleId);
      const vehicles = await driverClient.listVehicles(driverId ?? "");
      return vehicles.find((v) => v.active) ?? vehicles[0] ?? null;
    },
    enabled: driverId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const name = driverQuery.data ?? "Your driver";
  const v = vehicleQuery.data ?? null;
  const vehicle = v ? [[v.brand, v.model].filter(Boolean).join(" "), v.plateNumber].filter(Boolean).join(", ") : null;
  const phase = tripView(trip.status).riderPhase;
  const headline =
    phase === "arrived" ? "Your driver has arrived" : phase === "in-progress" ? "On the way to your destination" : "Your driver is on the way";

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-raised p-4" aria-label="Driver">
      <Avatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-content-muted">{headline}</p>
        <p className="truncate text-base font-bold">{name}</p>
        {vehicle ? <p className="truncate text-sm">{vehicle}</p> : null}
      </div>
    </div>
  );
}

/** Payment status line for a completed trip (Req 7.8). */
function PaymentStatusLine({ tripId }: { tripId: string }) {
  const query = useQuery({
    queryKey: ["trip-payment", tripId],
    queryFn: () => paymentClient.getPaymentForTrip(tripId),
    retry: false,
  });
  const text = query.isPending
    ? "Checking payment…"
    : query.isError
      ? "Payment status unavailable"
      : `Payment: ${query.data.status.charAt(0)}${query.data.status.slice(1).toLowerCase().replace(/_/g, " ")}`;
  return (
    <p className="text-center text-sm text-content-muted" data-testid="payment-status">
      {text}
    </p>
  );
}

/** Confirmation dialog for cancelling a ride (Req 7.6). */
function CancelDialog({ busy, onConfirm, onDismiss }: { busy: boolean; onConfirm: () => void; onDismiss: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cancel-dialog-title"
      className="flex flex-col gap-3 rounded-2xl border-2 border-danger bg-surface-raised p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onDismiss();
      }}
    >
      <p id="cancel-dialog-title" className="text-base font-semibold">
        Cancel this ride?
      </p>
      <div className="flex gap-3">
        <Button variant="secondary" size="lg" block autoFocus onClick={onDismiss} disabled={busy}>
          Keep ride
        </Button>
        <Button variant="danger" size="lg" block loading={busy} onClick={onConfirm}>
          Yes, cancel
        </Button>
      </div>
    </div>
  );
}

/** Ticks once a second while enabled, so time-based messages update. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function HomeScreen() {
  const identity = useCurrentIdentity();
  const riderId = identity.current("rider")?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>("MOTORBIKE");
  const [tripId, setTripId] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PaymentMethod>("CASH");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const submitting = useRef(false);
  const resumed = useRef(false);

  const tooClose = pickup !== null && destination !== null && isTooClose(pickup, destination);
  const routeReady = pickup !== null && destination !== null && !tooClose;

  const estimatesQuery = useQuery<FareEstimate[], Error>({
    queryKey: ["fare-estimates", pickup?.lat, pickup?.lng, destination?.lat, destination?.lng],
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

  // Resume an in-progress trip on mount (Req 6.10).
  const resumeQuery = useQuery({
    queryKey: ["rider-resume", riderId],
    queryFn: () => tripClient.listTrips({ passengerId: riderId }),
    enabled: riderId !== "",
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (resumed.current || !resumeQuery.data) return;
    resumed.current = true;
    const active = findResumableTrip(resumeQuery.data.items);
    if (active) setTripId(active.id);
  }, [resumeQuery.data]);

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
      queryClient.setQueryData(["trip", trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ["rider-history", riderId] });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const cancelMutation = useMutation<TripResponse, Error, string>({
    mutationFn: (id) => tripClient.cancelTrip(id),
    onSuccess: (trip) => {
      setConfirmingCancel(false);
      queryClient.setQueryData(["trip", trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ["rider-history", riderId] });
    },
    // On failure the dialog closes, the backend message is shown, and the trip stays on screen (Req 7.7).
    onError: () => setConfirmingCancel(false),
  });

  function resetJourney() {
    setTripId(null);
    setDestination(null);
    setConfirmingCancel(false);
    cancelMutation.reset();
    requestMutation.reset();
  }

  /** Try again after no driver was found: cancel the stale trip, keep the places, and rebook. */
  function tryAgain(id: string) {
    cancelMutation.mutate(id, {
      onSuccess: () => {
        setTripId(null);
        cancelMutation.reset();
        requestMutation.reset();
      },
    });
  }

  function confirm(paypalOrderId?: string) {
    if (!pickup || !destination || tooClose) return;
    if (submitting.current || requestMutation.isPending) return;
    submitting.current = true;
    requestMutation.mutate({
      ...buildCreateTripRequest({ passengerId: riderId, pickup, destination, rideType: vehicleType, paymentMethod: payWith }),
      ...(paypalOrderId ? { paypalOrderId } : {}),
    });
  }

  function swap() {
    const next = swapPlaces(pickup, destination);
    setPickup(next.pickup);
    setDestination(next.destination);
  }

  const selectedQuote = estimatesQuery.data?.find((e) => e.vehicleType === vehicleType) ?? null;
  const trip = tripQuery.data ?? null;
  const view = trip ? tripView(trip.status) : null;
  const searchingNow = trip !== null && (trip.status === "SEARCHING" || trip.status === "REQUESTED");
  const now = useNow(searchingNow);
  const noDriver = trip !== null && isNoDriverTimeout(trip, now);
  const announcement = trip ? statusAnnouncement(trip.status) : "";
  const cancelError = cancelMutation.isError ? friendlyError(cancelMutation.error) : null;

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
          {trip.cancellationReason ? (
            <p className="text-sm text-content-muted" data-testid="cancellation-reason">
              Reason: {trip.cancellationReason}
            </p>
          ) : null}
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
          <PaymentStatusLine tripId={trip.id} />
          <DriverCard trip={trip} />
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
            noDriver ? (
              <div role="alert" className="flex flex-col gap-3">
                <p className="text-base font-semibold">No driver was found. You can try again or cancel.</p>
                <Button size="lg" block loading={cancelMutation.isPending} onClick={() => tryAgain(trip.id)}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-accent/30 animate-pulse-ring" />
                  <Car className="relative h-5 w-5 text-accent" aria-hidden="true" />
                </span>
                <p className="text-base font-semibold">Searching for a nearby driver…</p>
              </div>
            )
          ) : (
            <div className="flex items-center justify-between">
              <Badge status={trip.status} />
              {trip.estimatedFare !== null ? <span className="font-bold">{formatVnd(trip.estimatedFare)}</span> : null}
            </div>
          )}
          {streamState === "reconnecting" ? (
            <p role="status" className="text-sm text-content-muted">
              Reconnecting to driver location
            </p>
          ) : null}
          {view.showDriverCard ? <DriverCard trip={trip} /> : null}
          {cancelError ? (
            <p role="alert" className="text-sm text-danger">
              {cancelError}
            </p>
          ) : null}
          {view.showCancel ? (
            confirmingCancel ? (
              <CancelDialog
                busy={cancelMutation.isPending}
                onConfirm={() => cancelMutation.mutate(trip.id)}
                onDismiss={() => setConfirmingCancel(false)}
              />
            ) : (
              <Button
                variant="danger"
                size="lg"
                block
                onClick={() => {
                  cancelMutation.reset();
                  setConfirmingCancel(true);
                }}
              >
                Cancel ride
              </Button>
            )
          ) : null}
        </div>
      );
    }
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <AddressInput
          id="home-pickup"
          label="Pickup"
          value={pickup}
          onChange={setPickup}
          geocoder={geocoder}
          placeholder="Pickup address"
          allowCurrentLocation
        />
        <Button variant="secondary" size="md" touch leftIcon={<ArrowUpDown className="h-4 w-4" />} onClick={swap} className="self-center">
          Swap pickup and destination
        </Button>
        <AddressInput
          id="home-destination"
          label="Where to?"
          value={destination}
          onChange={setDestination}
          geocoder={geocoder}
          placeholder="Destination address"
        />

        {tooClose ? (
          <p role="alert" className="text-sm text-danger">
            Pickup and destination are too close. Choose places at least 100 metres apart.
          </p>
        ) : null}

        {routeReady ? (
          estimatesQuery.isPending ? (
            <QuoteSkeleton />
          ) : estimatesQuery.isError ? (
            <ErrorState error={estimatesQuery.error} onRetry={() => void estimatesQuery.refetch()} />
          ) : (
            <QuoteList estimates={estimatesQuery.data} selected={vehicleType} onSelect={setVehicleType} />
          )
        ) : null}

        {routeReady && estimatesQuery.isSuccess ? (
          <p className="text-xs text-content-muted">Fares are estimates. The final fare is set when the trip ends.</p>
        ) : null}

        <fieldset className="flex flex-wrap gap-4" aria-label="Payment method">
          {PAYMENT_OPTIONS.map((m) => (
            <label key={m.value} className="flex min-h-11 min-w-11 items-center gap-2 text-sm">
              <input type="radio" name="payWith" checked={payWith === m.value} onChange={() => setPayWith(m.value)} />
              {m.label}
            </label>
          ))}
        </fieldset>
        {requestMutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            {friendlyError(requestMutation.error)}
          </p>
        ) : null}
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
        onStreamState={setStreamState}
        sheetHeight={Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.55)}
      />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="trip-announcer">
        {announcement}
      </div>
      <BottomSheet label={label} defaultSnap="half">
        {body}
      </BottomSheet>
    </div>
  );
}
