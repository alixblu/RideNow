/**
 * DriverApp — the Driver_App route table (Req 5.1). Mounted at `/driver/*`.
 *
 * `DriverLayout` supplies the phone column and bottom nav; the routed screens are
 * Drive (index), Earnings, and Account. The area owns a QueryClient scoped to itself so
 * its TanStack Query hooks work whether or not an outer provider is present.
 */
import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { AccountScreen } from "./AccountScreen";
import { DriveScreen } from "./DriveScreen";
import { DriverLayout } from "./DriverLayout";
import { EarningsScreen } from "./EarningsScreen";

export function DriverApp() {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<DriverLayout />}>
          <Route index element={<DriveScreen />} />
          <Route path="earnings" element={<EarningsScreen />} />
          <Route path="account" element={<AccountScreen />} />
          <Route path="*" element={<Navigate to="/driver" replace />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
