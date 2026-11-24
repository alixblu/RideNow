/**
 * RiderApp — the Rider_App route table, mounted at `/rider/*`.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { AccountScreen } from "./AccountScreen";
import { ActivityScreen } from "./ActivityScreen";
import { HomeScreen } from "./HomeScreen";
import { RiderLayout } from "./RiderLayout";
import { TripDetailScreen } from "./TripDetailScreen";

export function RiderApp() {
  return (
    <Routes>
      <Route element={<RiderLayout />}>
        <Route index element={<HomeScreen />} />
        <Route path="activity" element={<ActivityScreen />} />
        <Route path="activity/:tripId" element={<TripDetailScreen />} />
        <Route path="account" element={<AccountScreen />} />
        <Route path="*" element={<Navigate to="/rider" replace />} />
      </Route>
    </Routes>
  );
}

export default RiderApp;
