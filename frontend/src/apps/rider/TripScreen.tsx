/**
 * TripScreen — rider trip request form + trip lifecycle view (Req 9.1–9.4, 9.6).
 *
 * Request form (Req 9.1, 9.6):
 *   - passengerId is taken from the rider Current_Identity (read-only).
 *   - rideType is restricted to VEHICLE_TYPE_VALUES (Req 9.1 enum).
 *   - pickup/destination are numeric lat/lng inputs presented Uber-style as stacked
 *     "where from / where to" fields beside a STATIC map-style panel. There is
 *     deliberately NO real map, live-location, or real-time UI (Req 9.6); the panel is
 *     decorative and the inputs remain the source of truth.
 *   On submit the trip client creates a trip; the created trip renders with its
 *   Trip_Status, REQUESTED for a newly requested trip (Req 9.1).
 *
 * Lifecycle view (Req 9.2–9.4): any trip (just-created or looked up by id) renders its
 * Trip_Status from the defined set (Req 9.2); a trip can be fetched by id (Req 9.3); a
 * Cancel action cancels an eligible trip and the result shows CANCELLED (Req 9.4).
 *
 * The active trip id is lifted to RiderApp so matching and payment reuse it.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPin, CircleDot, Navigation } from "lucide-react";
import { resolveTripClient } from "../../domain/trip";
import type { CreateTripRequest, TripResponse } from "../../domain/trip";
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
  ErrorBanner,
  Field,
  Input,
  Loading,
  Select,
  useToast,
} from "../../shared/ui";
import { TripDetail, errorView, toMessage } from "./shared";

const tripClient = resolveTripClient(appConfig);

/** Trip statuses that can no longer be cancelled by the rider. */
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED"] as const;

interface TripScreenProps {
  activeTripId: string | null;
  onActiveTripChange: (tripId: string | null) => void;
}

export function TripScreen({ activeTripId, onActiveTripChange }: TripScreenProps) {
  const identity = useCurrentIdentity();
  const passengerId = identity.current("rider")?.id ?? "";
  const { toast } = useToast();

  const [rideType, setRideType] = useState<VehicleType>(VEHICLE_TYPE_VALUES[0]);
  const [pickupLat, setPickupLat] = useState("10.7769");
  const [pickupLng, setPickupLng] = useState("106.7009");
  const [destinationLat, setDestinationLat] = useState("10.8231");
  const [destinationLng, setDestinationLng] = useState("106.6297");
  const [lookupId, setLookupId] = useState("");

  const requestMutation = useMutation<TripResponse, Error, CreateTripRequest>({
    mutationFn: (req) => tripClient.requestTrip(req),
    onSuccess: (trip) => {
      onActiveTripChange(trip.id);
      toast("Trip requested — searching for a driver.", "success");
    },
    onError: (err) => toast(toMessage(err), "error"),
  });

  const tripQuery = useQuery<TripResponse, Error>({
    queryKey: ["trip", activeTripId],
    queryFn: () => tripClient.getTrip(activeTripId as string),
    enabled: activeTripId !== null,
  });

  const cancelMutation = useMutation<TripResponse, Error, string>({
    mutationFn: (id) => tripClient.cancelTrip(id),
    onSuccess: () => {
      void tripQuery.refetch();
      toast("Trip cancelled.", "info");
    },
    onError: (err) => toast(toMessage(err), "error"),
  });

  function handleRequest(event: FormEvent) {
    event.preventDefault();
    requestMutation.mutate({
      passengerId,
      rideType,
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      destinationLat: Number(destinationLat),
      destinationLng: Number(destinationLng),
    });
  }

  function handleLookup(event: FormEvent) {
    event.preventDefault();
    const trimmed = lookupId.trim();
    if (trimmed.length > 0) {
      onActiveTripChange(trimmed);
    }
  }

  const activeTrip = tripQuery.data ?? null;
  const canCancel =
    activeTrip !== null &&
    !(TERMINAL_STATUSES as readonly string[]).includes(activeTrip.status);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Request panel — Uber-style location form + static map. */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Request a trip</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Static map-style panel (decorative; live-location is deferred). */}
            <div className="rn-map-grid relative hidden min-h-[220px] rounded-2xl border border-border sm:block">
              <div className="absolute left-5 top-6 flex items-center gap-2 text-content-muted">
                <CircleDot className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="text-xs">Pickup</span>
              </div>
              <div className="absolute bottom-6 right-5 flex items-center gap-2 text-content-muted">
                <MapPin className="h-4 w-4 text-danger" aria-hidden="true" />
                <span className="text-xs">Destination</span>
              </div>
              <Navigation className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-content-subtle" aria-hidden="true" />
            </div>

            <form className="flex flex-col gap-3" onSubmit={handleRequest} aria-label="Request a trip">
              <Field htmlFor="trip-passenger" label="Passenger ID">
                <Input id="trip-passenger" value={passengerId} readOnly />
              </Field>

              <Field htmlFor="trip-ride-type" label="Ride type">
                <Select
                  id="trip-ride-type"
                  value={rideType}
                  onChange={(e) => setRideType(e.target.value as VehicleType)}
                >
                  {VEHICLE_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field htmlFor="trip-pickup-lat" label="Pickup lat">
                  <Input id="trip-pickup-lat" type="number" step="any" value={pickupLat} onChange={(e) => setPickupLat(e.target.value)} />
                </Field>
                <Field htmlFor="trip-pickup-lng" label="Pickup lng">
                  <Input id="trip-pickup-lng" type="number" step="any" value={pickupLng} onChange={(e) => setPickupLng(e.target.value)} />
                </Field>
                <Field htmlFor="trip-dest-lat" label="Dest. lat">
                  <Input id="trip-dest-lat" type="number" step="any" value={destinationLat} onChange={(e) => setDestinationLat(e.target.value)} />
                </Field>
                <Field htmlFor="trip-dest-lng" label="Dest. lng">
                  <Input id="trip-dest-lng" type="number" step="any" value={destinationLng} onChange={(e) => setDestinationLng(e.target.value)} />
                </Field>
              </div>

              <Button type="submit" size="lg" block loading={requestMutation.isPending}>
                {requestMutation.isPending ? "Finding your ride…" : "Request ride"}
              </Button>

              {requestMutation.isError ? (
                <ErrorBanner message={toMessage(requestMutation.error)} />
              ) : null}
            </form>
          </div>
        </CardBody>
      </Card>

      {/* Lifecycle panel. */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your ride</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="flex items-end gap-2" onSubmit={handleLookup} aria-label="Look up a trip">
            <Field htmlFor="trip-lookup" label="Trip ID" className="flex-1">
              <Input
                id="trip-lookup"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="Enter a trip ID to load"
              />
            </Field>
            <Button type="submit" variant="secondary">
              Load
            </Button>
          </form>

          <div className="mt-4">
            {activeTripId === null ? (
              <p className="text-sm text-content-subtle">
                Request a ride, or paste a trip ID to pick one up where you left off.
              </p>
            ) : tripQuery.isPending ? (
              <Loading label="Loading trip…" />
            ) : tripQuery.isError ? (
              errorView(tripQuery.error, () => void tripQuery.refetch())
            ) : activeTrip !== null ? (
              <>
                <TripDetail trip={activeTrip} />
                <Button
                  variant="danger"
                  block
                  className="mt-4"
                  disabled={!canCancel}
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(activeTrip.id)}
                >
                  {cancelMutation.isPending ? "Cancelling…" : "Cancel ride"}
                </Button>
                {cancelMutation.isError ? (
                  <div className="mt-2">
                    <ErrorBanner message={toMessage(cancelMutation.error)} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
