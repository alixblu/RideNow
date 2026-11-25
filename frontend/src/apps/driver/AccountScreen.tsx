/**
 * AccountScreen — the Driver_App's Account destination (Req 9.7).
 *
 * Shows the driver's name, email, license number, vehicles, and the sign-out control.
 * Name and email come from user-service; the license number from the driver profile.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverServiceClient } from "../../domain/driver/contract";
import { resolveUserClient } from "../../domain/user";
import type { UserResponse, UserServiceClient } from "../../domain/user";
import type { VehicleResponse } from "../../domain/vehicle/contract";
import { SIGN_IN_PATH } from "../../identity/guard";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton } from "../../shared/ui";
import { useDriver } from "./DriverContext";

interface AccountScreenProps {
  client?: DriverServiceClient;
  userClient?: Pick<UserServiceClient, "getUser">;
}

function vehicleTitle(v: VehicleResponse): string {
  const name = [v.brand, v.model].filter(Boolean).join(" ");
  return name === "" ? v.plateNumber : name;
}

export function AccountScreen({ client, userClient }: AccountScreenProps) {
  const driverClient = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const users = useMemo(() => userClient ?? resolveUserClient(appConfig), [userClient]);
  const { identity, signOut } = useCurrentIdentity();
  const navigate = useNavigate();
  const driver = useDriver();
  const accountId = identity?.id ?? driver.userId;

  const userQuery = useQuery<UserResponse, Error>({
    queryKey: ["account-user", accountId],
    queryFn: () => users.getUser(accountId),
    retry: false,
  });
  const vehiclesQuery = useQuery<VehicleResponse[], Error>({
    queryKey: ["vehicles", driver.id],
    queryFn: () => driverClient.listVehicles(driver.id),
  });

  const name = userQuery.data?.fullName ?? "Driver";

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
          {userQuery.isPending ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <p className="truncate text-lg font-semibold">{name}</p>
          )}
          {userQuery.data ? (
            <p className="truncate text-sm text-content-muted">{userQuery.data.email}</p>
          ) : null}
          <p className="text-sm text-content-muted">
            License <span className="font-medium text-content">{driver.licenseNumber}</span>
          </p>
        </div>
      </Card>
      <section aria-label="Vehicles" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Vehicles</h2>
        {vehiclesQuery.isPending ? (
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
