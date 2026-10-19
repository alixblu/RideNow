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
import { IdentityPrompt, cn } from "../../shared/ui";
import { TripScreen } from "./TripScreen";
import { MatchingScreen } from "./MatchingScreen";
import { PaymentScreen } from "./PaymentScreen";
import { NotificationsScreen } from "./NotificationsScreen";

type RiderTab = "trip" | "matching" | "payment" | "notifications";

const TABS: readonly { id: RiderTab; label: string }[] = [
  { id: "trip", label: "Trip" },
  { id: "matching", label: "Matching" },
  { id: "payment", label: "Payment" },
  { id: "notifications", label: "Notifications" },
];

export function RiderApp() {
  const [tab, setTab] = useState<RiderTab>("trip");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);

  return (
    <section aria-label="Rider area" className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Book a ride</h2>
        <p className="mt-1 text-sm text-content-muted">
          Set your pickup and drop-off, then track it through to payment.
        </p>
      </header>

      <IdentityPrompt role="rider">
        {/* Understated underline tabs rather than a filled pill group. */}
        <nav
          aria-label="Rider screens"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors",
                  active
                    ? "border-accent font-medium text-content"
                    : "border-transparent text-content-subtle hover:text-content",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div>
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
