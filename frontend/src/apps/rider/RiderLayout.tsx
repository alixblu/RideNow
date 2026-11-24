/**
 * RiderLayout — phone-width column with the Rider bottom navigation.
 * Home, Activity and Account live inside it via the router outlet.
 */
import { Clock, Home, User } from "lucide-react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "../../shared/layout/BottomNav";
import type { BottomNavItem } from "../../shared/layout/BottomNav";
import { PhoneColumn } from "../../shared/layout/PhoneColumn";

export const RIDER_NAV_ITEMS: BottomNavItem[] = [
  { to: "/rider", label: "Home", icon: <Home className="h-5 w-5" />, end: true },
  { to: "/rider/activity", label: "Activity", icon: <Clock className="h-5 w-5" />, end: false },
  { to: "/rider/account", label: "Account", icon: <User className="h-5 w-5" />, end: false },
];

export function RiderLayout() {
  return (
    <PhoneColumn className="bg-surface text-content" >
      <div data-touch className="relative flex min-h-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        <BottomNav items={RIDER_NAV_ITEMS} label="Rider" />
      </div>
    </PhoneColumn>
  );
}
