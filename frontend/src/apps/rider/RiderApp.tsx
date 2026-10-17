/**
 * RiderApp — the Rider_App area (Req 1.1).
 *
 * Hosts the rider flows over the stubbed trip, matching, payment, and notification
 * clients: trip request + lifecycle (Req 9.*), matching (Req 10.*), payment (Req 11.*),
 * and notifications (Req 12.*). All rider actions need a rider acting principal, so the
 * whole area is wrapped in the identity-prompt guard, which shows a "set your identity"
 * prompt until a rider Current_Identity is set (Req 2.4).
 *
 * In-area navigation is a set of stateful tabs (not nested routes). The active trip id
 * is held here and shared down to the trip, matching, and payment screens so a
 * just-requested trip flows straight into matching and payment.
 *
 * Screens render identically whether backed by a mock or live client — no mock/live
 * marker anywhere (Req 4.5). Restyled Uber-style on the Tailwind kit; the rider screens
 * nav keeps `aria-label="Rider screens"`.
 */
import { useState } from "react";
import { MapPin, Search, CreditCard, Bell } from "lucide-react";
import { IdentityPrompt, cn } from "../../shared/ui";
import { TripScreen } from "./TripScreen";
import { MatchingScreen } from "./MatchingScreen";
import { PaymentScreen } from "./PaymentScreen";
import { NotificationsScreen } from "./NotificationsScreen";

type RiderTab = "trip" | "matching" | "payment" | "notifications";

const TABS: readonly { id: RiderTab; label: string; icon: typeof MapPin }[] = [
  { id: "trip", label: "Trip", icon: MapPin },
  { id: "matching", label: "Matching", icon: Search },
  { id: "payment", label: "Payment", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export function RiderApp() {
  const [tab, setTab] = useState<RiderTab>("trip");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);

  return (
    <section aria-label="Rider area" className="flex flex-col gap-5">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">Rider</h2>
        <p className="text-sm text-content-muted">
          Request a ride and follow it from pickup to payment.
        </p>
      </header>

      <IdentityPrompt role="rider">
        <nav
          aria-label="Rider screens"
          className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1"
        >
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "bg-accent text-accent-fg"
                    : "text-content-muted hover:bg-surface-raised hover:text-content",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "trip" ? (
            <TripScreen
              activeTripId={activeTripId}
              onActiveTripChange={setActiveTripId}
            />
          ) : tab === "matching" ? (
            <MatchingScreen activeTripId={activeTripId} />
          ) : tab === "payment" ? (
            <PaymentScreen activeTripId={activeTripId} />
          ) : (
            <NotificationsScreen />
          )}
        </div>
      </IdentityPrompt>
    </section>
  );
}
