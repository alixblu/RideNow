/**
 * RiderApp — the Rider_App area.
 *
 * The rider area is a single, stateful RIDE JOURNEY wired to the real trip + payment
 * Service_Clients, plus a "Your rides" list. Rather than four disconnected API-style
 * tabs, the rider books a ride by picking named places, then watches one live journey
 * advance through its Trip_Status — searching, driver assigned, in progress, completed —
 * with a fare panel and a cancel affordance, exactly as a real ride app behaves.
 *
 * In-area navigation ("Rider screens") switches between the live journey and the rides
 * list. Selecting a past ride opens its journey view (the only open-by-id path). All
 * rider actions require a rider Current_Identity, so the area is wrapped in the
 * identity-prompt guard.
 */
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleDot,
  MapPin,
  Navigation,
  Car,
  Clock,
  CreditCard,
  UserCheck,
} from "lucide-react";
import { resolveTripClient } from "../../domain/trip";
import type { CreateTripRequest, TripResponse } from "../../domain/trip";
import { resolvePaymentClient } from "../../domain/payment";
import type { PaymentResponse } from "../../domain/payment";
import { appConfig } from "../../config/appConfig";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";
import type { VehicleType } from "../../shared/enums";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Field,
  IdentityPrompt,
  Input,
  Loading,
  Select,
  Skeleton,
  StatusPill,
  cn,
  useToast,
} from "../../shared/ui";
import {
  PRESET_LOCATIONS,
  errorView,
  formatTimestamp,
  isNotFound,
  isTerminal,
  routeLabel,
  toMessage,
} from "./shared";

const tripClient = resolveTripClient(appConfig);
const paymentClient = resolvePaymentClient(appConfig);

// Default named places for the booking form. PRESET_LOCATIONS is non-empty by
// construction; these fallbacks keep the form well-typed under strict index access.
const DEFAULT_PICKUP = PRESET_LOCATIONS[0] ?? {
  id: "pickup",
  label: "Pickup",
  lat: 0,
  lng: 0,
};
const DEFAULT_DESTINATION = PRESET_LOCATIONS[1] ?? DEFAULT_PICKUP;

type RiderScreen = "journey" | "rides";

export function RiderApp() {
  const identity = useCurrentIdentity();
  const riderId = identity.current("rider")?.id ?? "";

  const [screen, setScreen] = useState<RiderScreen>("journey");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);

  // Opening a ride from the list jumps to the journey view focused on that trip.
  function openTrip(tripId: string) {
    setActiveTripId(tripId);
    setScreen("journey");
  }

  return (
    <section aria-label="Rider area" className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Book a ride</h2>
        <p className="mt-1 text-sm text-content-muted">
          Pick your pickup and drop-off, then follow your ride all the way through.
        </p>
      </header>

      <IdentityPrompt role="rider">
        <nav
          aria-label="Rider screens"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          <ScreenTab
            label="Ride"
            active={screen === "journey"}
            onClick={() => setScreen("journey")}
          />
          <ScreenTab
            label="Your rides"
            active={screen === "rides"}
            onClick={() => setScreen("rides")}
          />
        </nav>

        <div>
          {screen === "journey" ? (
            <RideJourney
              riderId={riderId}
              activeTripId={activeTripId}
              onActiveTripChange={setActiveTripId}
            />
          ) : (
            <YourRides riderId={riderId} activeTripId={activeTripId} onOpen={openTrip} />
          )}
        </div>
      </IdentityPrompt>
    </section>
  );
}

/** Understated underline tab used by the in-area "Rider screens" nav. */
function ScreenTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors",
        active
          ? "border-accent font-medium text-content"
          : "border-transparent text-content-subtle hover:text-content",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ride journey — the single stateful screen driven by the active trip.
// ---------------------------------------------------------------------------

interface RideJourneyProps {
  riderId: string;
  activeTripId: string | null;
  onActiveTripChange: (tripId: string | null) => void;
}

function RideJourney({ riderId, activeTripId, onActiveTripChange }: RideJourneyProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const requestMutation = useMutation<TripResponse, Error, CreateTripRequest>({
    mutationFn: (req) => tripClient.requestTrip(req),
    onSuccess: (trip) => {
      onActiveTripChange(trip.id);
      // Seed the trip query so the live view shows immediately without a refetch gap.
      queryClient.setQueryData(["trip", trip.id], trip);
      void queryClient.invalidateQueries({ queryKey: ["my-trips", riderId] });
      toast("Ride requested — searching for a driver.", "success");
    },
    onError: (err) => toast(toMessage(err), "error"),
  });

  // No active trip yet: show the "Where to?" booking form (initial journey step).
  if (activeTripId === null) {
    return (
      <WhereToForm
        riderId={riderId}
        pending={requestMutation.isPending}
        error={requestMutation.isError ? toMessage(requestMutation.error) : null}
        onSubmit={(req) => requestMutation.mutate(req)}
      />
    );
  }

  return (
    <LiveTrip
      riderId={riderId}
      tripId={activeTripId}
      onNewRide={() => onActiveTripChange(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// "Where to?" booking form — named places + ride type.
// ---------------------------------------------------------------------------

interface WhereToFormProps {
  riderId: string;
  pending: boolean;
  error: string | null;
  onSubmit: (req: CreateTripRequest) => void;
}

function WhereToForm({ riderId, pending, error, onSubmit }: WhereToFormProps) {
  const [pickupId, setPickupId] = useState(DEFAULT_PICKUP.id);
  const [destinationId, setDestinationId] = useState(DEFAULT_DESTINATION.id);
  const [rideType, setRideType] = useState<VehicleType>(VEHICLE_TYPE_VALUES[0]);

  // Optional advanced mode exposes raw coordinates; named places remain primary.
  const [advanced, setAdvanced] = useState(false);
  const pickupPreset =
    PRESET_LOCATIONS.find((p) => p.id === pickupId) ?? DEFAULT_PICKUP;
  const destinationPreset =
    PRESET_LOCATIONS.find((p) => p.id === destinationId) ?? DEFAULT_DESTINATION;
  const [pickupLat, setPickupLat] = useState(String(pickupPreset.lat));
  const [pickupLng, setPickupLng] = useState(String(pickupPreset.lng));
  const [destinationLat, setDestinationLat] = useState(String(destinationPreset.lat));
  const [destinationLng, setDestinationLng] = useState(String(destinationPreset.lng));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // In advanced mode the typed coordinates win; otherwise use the selected presets.
    const req: CreateTripRequest = advanced
      ? {
          passengerId: riderId,
          rideType,
          pickupLat: Number(pickupLat),
          pickupLng: Number(pickupLng),
          destinationLat: Number(destinationLat),
          destinationLng: Number(destinationLng),
        }
      : {
          passengerId: riderId,
          rideType,
          pickupLat: pickupPreset.lat,
          pickupLng: pickupPreset.lng,
          destinationLat: destinationPreset.lat,
          destinationLng: destinationPreset.lng,
        };
    onSubmit(req);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          {/* CardTitle renders an <h3>; text kept exactly "Request a trip" so the
              accessible heading name matches tests (AppShell.test, rider tests). */}
          <CardTitle>Request a trip</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Decorative map-style panel; the named selects are the source of truth. */}
            <div className="rn-map-grid relative hidden min-h-[240px] rounded-2xl border border-border sm:block">
              <div className="absolute left-5 top-6 flex items-center gap-2 text-content-muted">
                <CircleDot className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="text-xs">{pickupPreset.label}</span>
              </div>
              <div className="absolute bottom-6 right-5 flex items-center gap-2 text-content-muted">
                <MapPin className="h-4 w-4 text-danger" aria-hidden="true" />
                <span className="text-xs">{destinationPreset.label}</span>
              </div>
              <Navigation
                className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-content-subtle"
                aria-hidden="true"
              />
            </div>

            <form
              className="flex flex-col gap-3"
              onSubmit={handleSubmit}
              aria-label="Request a trip"
            >
              <Field htmlFor="where-from" label="Pickup">
                <Select
                  id="where-from"
                  value={pickupId}
                  onChange={(e) => setPickupId(e.target.value)}
                >
                  {PRESET_LOCATIONS.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field htmlFor="where-to" label="Destination">
                <Select
                  id="where-to"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                >
                  {PRESET_LOCATIONS.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field htmlFor="ride-type" label="Ride type">
                <Select
                  id="ride-type"
                  value={rideType}
                  onChange={(e) => setRideType(e.target.value as VehicleType)}
                >
                  {VEHICLE_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value === "MOTORBIKE" ? "Motorbike" : "Car"}
                    </option>
                  ))}
                </Select>
              </Field>

              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="self-start text-xs text-content-subtle underline-offset-2 hover:underline"
                aria-expanded={advanced}
              >
                {advanced ? "Hide coordinates" : "Enter coordinates manually"}
              </button>

              {advanced ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field htmlFor="pickup-lat" label="Pickup lat">
                    <Input
                      id="pickup-lat"
                      type="number"
                      step="any"
                      value={pickupLat}
                      onChange={(e) => setPickupLat(e.target.value)}
                    />
                  </Field>
                  <Field htmlFor="pickup-lng" label="Pickup lng">
                    <Input
                      id="pickup-lng"
                      type="number"
                      step="any"
                      value={pickupLng}
                      onChange={(e) => setPickupLng(e.target.value)}
                    />
                  </Field>
                  <Field htmlFor="dest-lat" label="Dest. lat">
                    <Input
                      id="dest-lat"
                      type="number"
                      step="any"
                      value={destinationLat}
                      onChange={(e) => setDestinationLat(e.target.value)}
                    />
                  </Field>
                  <Field htmlFor="dest-lng" label="Dest. lng">
                    <Input
                      id="dest-lng"
                      type="number"
                      step="any"
                      value={destinationLng}
                      onChange={(e) => setDestinationLng(e.target.value)}
                    />
                  </Field>
                </div>
              ) : null}

              <Button type="submit" size="lg" block loading={pending}>
                {pending ? "Finding your ride…" : "Request ride"}
              </Button>

              {error !== null ? <ErrorBanner message={error} /> : null}
            </form>
          </div>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardBody>
          <ol className="flex flex-col gap-3 text-sm text-content-muted">
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                <MapPin className="h-4 w-4" aria-hidden="true" />
              </span>
              Choose where you are and where you're headed.
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                <UserCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              We match you with a nearby driver.
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
              </span>
              Track the fare right through to payment.
            </li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live trip — polls the active trip and renders its journey + fare.
// ---------------------------------------------------------------------------

interface LiveTripProps {
  riderId: string;
  tripId: string;
  onNewRide: () => void;
}

function LiveTrip({ riderId, tripId, onNewRide }: LiveTripProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tripQuery = useQuery<TripResponse, Error>({
    queryKey: ["trip", tripId],
    queryFn: () => tripClient.getTrip(tripId),
    // Poll while the trip is live; stop once it reaches a terminal status.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminal(status) ? false : 3000;
    },
  });

  const cancelMutation = useMutation<TripResponse, Error, string>({
    mutationFn: (id) => tripClient.cancelTrip(id),
    onSuccess: (trip) => {
      queryClient.setQueryData(["trip", tripId], trip);
      void queryClient.invalidateQueries({ queryKey: ["my-trips", riderId] });
      toast("Ride cancelled.", "info");
    },
    onError: (err) => toast(toMessage(err), "error"),
  });

  const trip = tripQuery.data ?? null;
  const canCancel = trip !== null && !isTerminal(trip.status);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Your ride</CardTitle>
          <Button variant="ghost" size="sm" onClick={onNewRide}>
            Book another
          </Button>
        </CardHeader>
        <CardBody>
          {tripQuery.isPending ? (
            <Loading label="Loading your ride…" />
          ) : tripQuery.isError ? (
            errorView(tripQuery.error, () => void tripQuery.refetch())
          ) : trip !== null ? (
            <div className="flex flex-col gap-5">
              <TripStatusHeader trip={trip} />
              <TripTimeline trip={trip} />
              {trip.status !== "SEARCHING" &&
              (trip.driverId !== null || trip.vehicleId !== null) ? (
                <DriverPanel trip={trip} />
              ) : null}

              {canCancel ? (
                <Button
                  variant="danger"
                  block
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(trip.id)}
                >
                  {cancelMutation.isPending ? "Cancelling…" : "Cancel ride"}
                </Button>
              ) : null}
              {cancelMutation.isError ? (
                <ErrorBanner message={toMessage(cancelMutation.error)} />
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="lg:col-span-2">
        <FarePanel tripId={tripId} />
      </div>
    </div>
  );
}

/** The status pill + a "searching" affordance while we look for a driver. */
function TripStatusHeader({ trip }: { trip: TripResponse }) {
  const searching = trip.status === "SEARCHING";
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-content">
          {trip.rideType === "MOTORBIKE" ? "Motorbike" : "Car"} ride
        </span>
        <StatusPill status={trip.status} />
      </div>
      <p className="mt-2 break-all text-xs text-content-subtle">Trip {trip.id}</p>

      {searching ? (
        <div
          className="mt-4 flex items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex h-10 w-10 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent/30 animate-pulse-ring" />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Car className="h-4 w-4" aria-hidden="true" />
            </span>
          </span>
          <p className="text-sm text-content-muted">Searching for a nearby driver…</p>
        </div>
      ) : null}
    </div>
  );
}

/** Driver + vehicle ids and the fare estimate carried on the trip once assigned. */
function DriverPanel({ trip }: { trip: TripResponse }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
          <UserCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-content">Driver on the way</p>
          <p className="text-xs text-content-muted">Hang tight, help is near.</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-content-subtle">Driver</dt>
          <dd className="break-all">{trip.driverId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-subtle">Vehicle</dt>
          <dd className="break-all">{trip.vehicleId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-subtle">Estimated fare</dt>
          <dd>{trip.estimatedFare === null ? "—" : trip.estimatedFare.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-subtle">Final fare</dt>
          <dd>{trip.finalFare === null ? "—" : trip.finalFare.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Lifecycle timestamps present on the trip, in chronological order. */
function TripTimeline({ trip }: { trip: TripResponse }) {
  const steps: { label: string; at: string | null }[] = [
    { label: "Requested", at: trip.requestedAt },
    { label: "Driver assigned", at: trip.acceptedAt },
    { label: "Driver arrived", at: trip.arrivedAt },
    { label: "Trip started", at: trip.startedAt },
    { label: "Completed", at: trip.completedAt },
    { label: "Cancelled", at: trip.cancelledAt },
  ].filter((step) => step.at !== null);

  if (steps.length === 0) {
    return null;
  }

  return (
    <dl className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <div key={step.label} className="flex items-center justify-between gap-4 text-sm">
          <dt className="flex items-center gap-2 text-content-subtle">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {step.label}
          </dt>
          <dd className="text-content">{formatTimestamp(step.at)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Fare panel — the payment for the active trip (404 => quiet "no fare yet").
// ---------------------------------------------------------------------------

function FarePanel({ tripId }: { tripId: string }) {
  const paymentQuery = useQuery<PaymentResponse, Error>({
    queryKey: ["payment-for-trip", tripId],
    queryFn: () => paymentClient.getPaymentForTrip(tripId),
    // A missing payment is a normal pending state, not an error to retry.
    retry: false,
  });

  const payment = paymentQuery.data ?? null;
  const noFareYet = paymentQuery.isError && isNotFound(paymentQuery.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fare</CardTitle>
      </CardHeader>
      <CardBody>
        {paymentQuery.isPending ? (
          <Loading label="Loading fare…" />
        ) : noFareYet ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-5 py-6 text-center">
            <CreditCard
              className="mx-auto h-6 w-6 text-content-subtle"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-content-muted">No fare yet</p>
            <p className="mt-0.5 text-xs text-content-subtle">
              Your fare appears once the ride is settled.
            </p>
          </div>
        ) : paymentQuery.isError ? (
          errorView(paymentQuery.error, () => void paymentQuery.refetch())
        ) : payment !== null ? (
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-content-muted">
                <CreditCard className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm">{payment.method}</span>
              </span>
              <StatusPill status={payment.status} />
            </div>

            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight text-content">
                {payment.amount.toLocaleString()}
              </span>
              <span className="text-sm font-medium text-content-muted">
                {payment.currency}
              </span>
            </div>

            {payment.status === "FAILED" && payment.failureReason ? (
              <div className="mt-4">
                <ErrorBanner message={payment.failureReason} />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// "Your rides" — the rider's trips, selectable to open a journey view.
// ---------------------------------------------------------------------------

interface YourRidesProps {
  riderId: string;
  activeTripId: string | null;
  onOpen: (tripId: string) => void;
}

function YourRides({ riderId, activeTripId, onOpen }: YourRidesProps) {
  const tripsQuery = useQuery({
    queryKey: ["my-trips", riderId],
    queryFn: () => tripClient.listTrips({ passengerId: riderId }),
    enabled: riderId.length > 0,
  });

  const trips = useMemo(() => tripsQuery.data?.items ?? [], [tripsQuery.data]);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Your rides</CardTitle>
      </CardHeader>
      <CardBody>
        {tripsQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : tripsQuery.isError ? (
          errorView(tripsQuery.error, () => void tripsQuery.refetch())
        ) : trips.length === 0 ? (
          <EmptyState message="You have no rides yet. Book one to get started." />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Your rides">
            {trips.map((trip) => {
              const selected = trip.id === activeTripId;
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(trip.id)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors",
                      selected
                        ? "border-accent bg-surface-raised"
                        : "border-border hover:bg-surface-raised",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <StatusPill status={trip.status} />
                      <time
                        dateTime={trip.requestedAt}
                        className="text-xs text-content-subtle"
                      >
                        {formatTimestamp(trip.requestedAt)}
                      </time>
                    </div>
                    <span className="text-sm text-content">
                      {routeLabel(
                        trip.pickupAddress,
                        `${trip.pickupLat}, ${trip.pickupLng}`,
                        trip.destinationAddress,
                        `${trip.destinationLat}, ${trip.destinationLng}`,
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
