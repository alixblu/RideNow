/**
 * AccountScreen — the Driver_App's Account destination (Req 5.8, 3.7, 3.9).
 *
 * Shows the driver's profile, Driver_Rating, vehicles, and the sign-out control.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverRating, DriverServiceClientExt } from "../../domain/driver/contract";
import type { VehicleResponse } from "../../domain/vehicle/contract";
import { SIGN_IN_PATH } from "../../identity/guard";
import { mockProfiles } from "../../identity/mockProfiles";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton } from "../../shared/ui";

interface AccountScreenProps {
  client?: DriverServiceClientExt;
}

function vehicleTitle(v: VehicleResponse): string {
  const name = [v.brand, v.model].filter(Boolean).join(" ");
  return name === "" ? v.plateNumber : name;
}

export function AccountScreen({ client }: AccountScreenProps) {
  const driverClient = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const { identity, signOut } = useCurrentIdentity();
  const navigate = useNavigate();
  const driverId = identity?.role === "driver" ? identity.id : "";
  const profile = mockProfiles.driver.find((p) => p.userId === driverId);
  const name = profile?.name ?? "Driver";

  const ratingQuery = useQuery<DriverRating, Error>({
    queryKey: ["driver-rating", driverId],
    queryFn: () => driverClient.getDriverRating(driverId),
    enabled: driverId !== "",
    retry: false,
  });
  const vehiclesQuery = useQuery<VehicleResponse[], Error>({
    queryKey: ["vehicles", driverId],
    queryFn: () => driverClient.listVehicles(driverId),
    enabled: driverId !== "",
  });

  const handleSignOut = () => {
    signOut();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="sr-only">Account</h1>
      <Card className="flex items-center gap-4 p-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{name}</p>
          <p className="text-sm text-content-muted">Driver</p>
          {ratingQuery.isPending && driverId !== "" ? (
            <Skeleton className="mt-1 h-5 w-24" />
          ) : ratingQuery.data ? (
            <p className="mt-1 flex items-center gap-1 text-sm" aria-label="Driver rating">
              <Star className="h-4 w-4 fill-current text-warning" aria-hidden="true" />
              <span className="font-semibold">{ratingQuery.data.average.toFixed(1)}</span>
              <span className="text-content-muted">({ratingQuery.data.ratedTrips} trips)</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-content-muted">No rating yet</p>
          )}
        </div>
      </Card>

      <section aria-label="Vehicles" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Vehicles</h2>
        {vehiclesQuery.isPending && driverId !== "" ? (
          <Skeleton className="h-16 w-full" />
        ) : vehiclesQuery.isError ? (
          <ErrorState error={vehiclesQuery.error} onRetry={() => void vehiclesQuery.refetch()} />
        ) : (vehiclesQuery.data ?? []).length === 0 ? (
          <EmptyState message="No vehicles registered." />
        ) : (
          <ul className="flex flex-col gap-2">
            {(vehiclesQuery.data ?? []).map((v) => (
              <li key={v.id}>
                <Card className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{vehicleTitle(v)}</p>
                    <p className="text-xs text-content-muted">
                      {v.plateNumber}
                      {v.color ? ` · ${v.color}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-content-muted">
                    {v.vehicleType === "MOTORBIKE" ? "Motorbike" : "Car"}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button variant="secondary" size="lg" block onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
