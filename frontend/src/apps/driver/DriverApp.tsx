/**
 * DriverApp — the Driver_App area (Req 1.1) hosting the driver and vehicle flows.
 *
 * Driver actions are guarded behind a driver Current_Identity via the identity-prompt
 * guard (Req 2.4). Inside the guard a stateful tabbed layout switches between the
 * driver and vehicle screens. All screens share one `DriverServiceClient` resolved once
 * from `appConfig`, so swapping live/mock is a config change with no screen edits
 * (Req 4.2, 4.3); the driver client also serves the vehicle add/list/get operations
 * driver-service owns.
 *
 * This area owns a QueryClient scoped to itself so its TanStack Query hooks work
 * whether or not an outer provider is present (nearest provider wins). Restyled
 * Uber-style on the Tailwind kit.
 */
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IdentityPrompt, cn } from "../../shared/ui";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import { CreateDriverScreen } from "./CreateDriverScreen";
import { DriverLookupScreen } from "./DriverLookupScreen";
import { VehiclesScreen } from "./VehiclesScreen";

type Tab = "create" | "lookup" | "vehicles";

const TABS: { id: Tab; label: string }[] = [
  { id: "create", label: "Register" },
  { id: "lookup", label: "Look up" },
  { id: "vehicles", label: "Vehicles" },
];

export function DriverApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const client = useMemo(() => resolveDriverClient(appConfig), []);

  return (
    <QueryClientProvider client={queryClient}>
      <DriverAppContent client={client} />
    </QueryClientProvider>
  );
}

function DriverAppContent({
  client,
}: {
  client: ReturnType<typeof resolveDriverClient>;
}) {
  const [tab, setTab] = useState<Tab>("create");

  return (
    <section aria-label="Driver area" className="flex flex-col gap-5">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Driver desk</h2>
        <p className="mt-1 text-sm text-content-muted">
          Register drivers, keep their vehicles current, and flip availability on or off.
        </p>
      </header>

      <IdentityPrompt role="driver">
        <nav
          aria-label="Driver sections"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors",
                  active
                    ? "border-accent font-medium text-content"
                    : "border-transparent text-content-subtle hover:text-content",
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-6">
          {tab === "create" && <CreateDriverScreen client={client} />}
          {tab === "lookup" && <DriverLookupScreen client={client} />}
          {tab === "vehicles" && <VehiclesScreen client={client} />}
        </div>
      </IdentityPrompt>
    </section>
  );
}
