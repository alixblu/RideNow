/**
 * DriverLayout — the Driver_App's own layout (Req 5.1, 5.9): a centered phone column
 * with the routed screen above a bottom nav (Drive, Account).
 */
import { Outlet } from "react-router-dom";
import { Car, User } from "lucide-react";
import { BottomNav } from "../../shared/layout/BottomNav";
import type { BottomNavItem } from "../../shared/layout/BottomNav";
import { PhoneColumn } from "../../shared/layout/PhoneColumn";

export const DRIVER_NAV_ITEMS: BottomNavItem[] = [
  { to: "/driver", label: "Drive", icon: <Car className="h-5 w-5" />, end: true },
  { to: "/driver/account", label: "Account", icon: <User className="h-5 w-5" /> },
];

export function DriverLayout() {
  return (
    <PhoneColumn className="bg-surface" >
      <div data-touch className="flex min-h-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        <BottomNav items={DRIVER_NAV_ITEMS} label="Driver" />
      </div>
    </PhoneColumn>
  );
}
