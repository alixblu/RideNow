/**
 * TripDetailScreen — one trip: route on the map, fare, driver, payment status from
 * `GET /api/payments?tripId=` (Req 8.4). No ratings (Req 8.8).
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import { resolvePaymentClient } from "../../domain/payment";
import type { PaymentResponse } from "../../domain/payment";
import { resolveTripClient } from "../../domain/trip";
import type { TripResponse } from "../../domain/trip/contract";
import { resolveUserClient } from "../../domain/user";
import { resolveVehicleClient } from "../../domain/vehicle";
import { ApiError } from "../../http/ApiError";
import { MapCanvas } from "../../map/MapCanvas";
import { formatVnd } from "../../shared/format";
import { Avatar, Badge, Card, CardBody, EmptyState, ErrorState, Skeleton } from "../../shared/ui";
import { tripDate } from "./ActivityScreen";
import { tripRouteText } from "./history";

const tripClient = resolveTripClient(appConfig);
const paymentClient = resolvePaymentClient(appConfig);
const driverClient = resolveDriverClient(appConfig);
const userClient = resolveUserClient(appConfig);
const vehicleClient = resolveVehicleClient(appConfig);

interface DriverInfo {
  name: string;
  vehicle: string | null;
}

async function loadDriver(trip: TripResponse): Promise<DriverInfo | null> {
  if (trip.driverId === null) return null;
  const driver = await driverClient.getDriver(trip.driverId);
  const user = await userClient.getUser(driver.userId);
  let vehicle: string | null = null;
  if (trip.vehicleId !== null) {
    const v = await vehicleClient.getVehicle(trip.vehicleId);
    vehicle = [v.model ?? v.brand, v.plateNumber].filter(Boolean).join(", ");
  }
  return { name: user.fullName, vehicle };
}

/** The payment for a trip, or null when none exists (404). */
async function loadPayment(tripId: string): Promise<PaymentResponse | null> {
  try {
    return await paymentClient.getPaymentForTrip(tripId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function TripDetailScreen() {
  const { tripId = "" } = useParams<{ tripId: string }>();
  const trip = useQuery<TripResponse, Error>({
    queryKey: ["rider-trip", tripId],
    queryFn: () => tripClient.getTrip(tripId),
    enabled: tripId.length > 0,
  });
  const payment = useQuery<PaymentResponse | null, Error>({
    queryKey: ["rider-trip-payment", tripId],
    queryFn: () => loadPayment(tripId),
    enabled: tripId.length > 0,
  });
  const loaded = trip.data ?? null;
  const driver = useQuery<DriverInfo | null, Error>({
    queryKey: ["rider-trip-driver", loaded?.id, loaded?.driverId],
    queryFn: () => (loaded ? loadDriver(loaded) : Promise.resolve(null)),
    enabled: loaded !== null && loaded.driverId !== null,
  });

  const notFound = trip.error instanceof ApiError && trip.error.status === 404;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Link to="/rider/activity" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Activity
      </Link>
      <h1 className="text-2xl font-bold">Trip details</h1>
      {trip.isPending ? (
        <div role="status" aria-label="Loading trip" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : notFound ? (
        <EmptyState message="We couldn't find that trip." />
      ) : trip.isError ? (
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      ) : loaded === null ? null : (
        <>
          <div className="relative h-48 overflow-hidden rounded-2xl">
            <MapCanvas
              className="absolute inset-0 isolate"
              pickup={{ lat: loaded.pickupLat, lng: loaded.pickupLng }}
              destination={{ lat: loaded.destinationLat, lng: loaded.destinationLng }}
            />
          </div>

          <Card>
            <CardBody className="flex flex-col gap-2 pt-5">
              <div className="flex items-center justify-between">
                <time dateTime={loaded.requestedAt} className="text-xs text-content-muted">
                  {tripDate(loaded.requestedAt)}
                </time>
                <Badge status={loaded.status} />
              </div>
              <h2 className="text-xs font-semibold uppercase text-content-muted">Route</h2>
              <p className="text-sm font-semibold">{tripRouteText(loaded)}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-2 pt-5">
              <h2 className="text-xs font-semibold uppercase text-content-muted">Fare</h2>
              <p className="text-2xl font-bold">{formatVnd(loaded.finalFare ?? loaded.estimatedFare ?? 0)}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-content-muted">Payment</span>
                {payment.isPending ? (
                  <Skeleton className="h-5 w-16" />
                ) : payment.isError ? (
                  <span className="text-content-muted">Unavailable</span>
                ) : payment.data ? (
                  <Badge status={payment.data.status} />
                ) : (
                  <span className="text-content-muted">No payment</span>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex items-center gap-3 pt-5">
              {driver.data ? (
                <>
                  <Avatar name={driver.data.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xs font-semibold uppercase text-content-muted">Driver</h2>
                    <p className="truncate text-base font-bold">{driver.data.name}</p>
                    {driver.data.vehicle ? (
                      <p className="truncate text-sm text-content-muted">{driver.data.vehicle}</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-semibold uppercase text-content-muted">Driver</h2>
                  <p className="text-sm text-content-muted">
                    {loaded.driverId === null
                      ? "No driver was assigned."
                      : driver.isPending
                        ? "Loading…"
                        : "Driver details unavailable."}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
