/**
 * DriverApp — the Driver_App route table (Req 5.1). Mounted at `/driver/*`.
 *
 * On mount it looks up the driver profile that belongs to the signed-in Account
 * (`GET /api/drivers?userId=`). No profile shows the onboarding form; otherwise the
 * profile is provided through `DriverContext` and `DriverLayout` supplies the phone
 * column and bottom nav around the Drive (index) and Account screens. The area owns a
 * QueryClient scoped to itself so its TanStack Query hooks work whether or not an outer
 * provider is present.
 */
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverResponse, DriverServiceClient } from "../../domain/driver/contract";
import { SIGN_IN_PATH } from "../../identity/guard";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { PhoneColumn } from "../../shared/layout/PhoneColumn";
import { Button, ErrorState, Skeleton } from "../../shared/ui";
import { AccountScreen } from "./AccountScreen";
import { DriveScreen } from "./DriveScreen";
import { DriverContext } from "./DriverContext";
import { DriverLayout } from "./DriverLayout";
import { OnboardingScreen } from "./OnboardingScreen";

interface DriverAppProps {
  client?: DriverServiceClient | undefined;
}

function DriverGate({ client }: DriverAppProps) {
  const driverClient = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const { identity, signOut } = useCurrentIdentity();
  const navigate = useNavigate();
  const accountId = identity?.role === "driver" ? identity.id : "";
  const [created, setCreated] = useState<DriverResponse | null>(null);

  const lookup = useQuery<DriverResponse | null, Error>({
    queryKey: ["driver-profile", accountId],
    enabled: accountId !== "",
    retry: false,
    queryFn: async () => {
      const page = await driverClient.listDrivers({ userId: accountId, limit: 1 });
      return page.items[0] ?? null;
    },
  });

  const driver = created ?? lookup.data ?? null;

  if (driver) {
    return (
      <DriverContext.Provider value={driver}>
        <Routes>
          <Route element={<DriverLayout />}>
            <Route index element={<DriveScreen />} />
            <Route path="account" element={<AccountScreen />} />
            <Route path="*" element={<Navigate to="/driver" replace />} />
          </Route>
        </Routes>
      </DriverContext.Provider>
    );
  }

  const handleSignOut = () => {
    signOut();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  return (
    <PhoneColumn className="bg-surface">
      <div data-touch className="flex min-h-0 flex-1 flex-col">
        {lookup.isPending || accountId === "" ? (
          <div role="status" aria-label="Loading" className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : lookup.isError ? (
          <div className="flex flex-col gap-3 p-4">
            <ErrorState error={lookup.error} onRetry={() => void lookup.refetch()} />
            <Button variant="secondary" size="lg" block onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <>
            <OnboardingScreen userId={accountId} client={driverClient} onComplete={setCreated} />
            <div className="p-4 pt-0">
              <Button variant="ghost" size="lg" block onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
          </>
        )}
      </div>
    </PhoneColumn>
  );
}

export function DriverApp({ client }: DriverAppProps = {}) {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <DriverGate client={client} />
    </QueryClientProvider>
  );
}
