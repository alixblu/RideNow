/**
 * AdminApp — the Admin_Dashboard route table, mounted at `/admin/*`.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { OverviewScreen } from "./OverviewScreen";
import { DriversScreen, PaymentsScreen, RidersScreen, TripsScreen } from "./tables";

export function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<OverviewScreen />} />
        <Route path="trips" element={<TripsScreen />} />
        <Route path="drivers" element={<DriversScreen />} />
        <Route path="riders" element={<RidersScreen />} />
        <Route path="payments" element={<PaymentsScreen />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

export default AdminApp;
