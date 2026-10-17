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
import { IdCard, Car } from "lucide-react";
import { IdentityPrompt, cn } from "../../shared/ui";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import { CreateDriverScreen } from "./CreateDriverScreen";
import { DriverLookupScreen } from "./DriverLookupScreen";
import { VehiclesScreen } from "./VehiclesScreen";

type Tab = "create" | "lookup" | "vehicles";

const TABS: { id: Tab; label: string; icon: typeof IdCard }[] = [
  { id: "create", label: "Create driver", icon: IdCard },
  { id: "lookup", label: "Driver lookup", icon: IdCard },
  { id: "vehicles", label: "Vehicles", icon: Car },
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
        <h2 className="text-2xl font-bold tracking-tight">Driver</h2>
        <p className="text-sm text-content-muted">
          Register drivers, manage vehicles, and change availability.
        </p>
      </header>

      <IdentityPrompt role="driver">
        <nav
          aria-label="Driver sections"
          className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "bg-accent text-accent-fg"
                    : "text-content-muted hover:bg-surface-raised hover:text-content",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "create" && <CreateDriverScreen client={client} />}
          {tab === "lookup" && <DriverLookupScreen client={client} />}
          {tab === "vehicles" && <VehiclesScreen client={client} />}
        </div>
      </IdentityPrompt>
    </section>
  );
}
