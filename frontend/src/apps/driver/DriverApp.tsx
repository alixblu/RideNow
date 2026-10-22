/**
 * DriverApp — the Driver_App area (Req 1.1) hosting the driver and vehicle flows.
 *
 * Driver actions are guarded behind a driver Current_Identity via the identity-prompt
 * guard (Req 2.4). Inside the guard an in-area nav switches between two sections:
 *   - Roster (PRIMARY): browse the live driver list, open one by selection to see its
 *     profile, vehicles, and status toggle, and accept SEARCHING trips through the real
 *     accept endpoint.
 *   - Register driver (SECONDARY): the create-driver form for onboarding a new driver.
 *
 * All screens share one `DriverServiceClient` resolved once from `appConfig`, so swapping
 * live/mock is a config change with no screen edits (Req 4.2, 4.3); the driver client
 * also serves the vehicle add/list/get operations driver-service owns. The trip client,
 * resolved the same way, backs the "Available rides" accept flow.
 *
 * This area owns a QueryClient scoped to itself so its TanStack Query hooks work whether
 * or not an outer provider is present (nearest provider wins).
 */
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IdentityPrompt, cn } from "../../shared/ui";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import { resolveTripClient } from "../../domain/trip";
import { DriverRoster } from "./DriverRoster";
import { CreateDriverScreen } from "./CreateDriverScreen";

type Section = "roster" | "register";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "roster", label: "Roster" },
  { id: "register", label: "Register driver" },
];

export function DriverApp() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const client = useMemo(() => resolveDriverClient(appConfig), []);
  const tripClient = useMemo(() => resolveTripClient(appConfig), []);

  return (
    <QueryClientProvider client={queryClient}>
      <DriverAppContent client={client} tripClient={tripClient} />
    </QueryClientProvider>
  );
}

function DriverAppContent({
  client,
  tripClient,
}: {
  client: ReturnType<typeof resolveDriverClient>;
  tripClient: ReturnType<typeof resolveTripClient>;
}) {
  const [section, setSection] = useState<Section>("roster");

  return (
    <section aria-label="Driver area" className="flex flex-col gap-5">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Driver desk</h2>
        <p className="mt-1 text-sm text-content-muted">
          Browse your drivers, keep their vehicles current, and pick up the rides that
          are waiting.
        </p>
      </header>

      <IdentityPrompt role="driver">
        <nav
          aria-label="Driver sections"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          {SECTIONS.map(({ id, label }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(id)}
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
          {section === "roster" && (
            <DriverRoster client={client} tripClient={tripClient} />
          )}
          {section === "register" && <CreateDriverScreen client={client} />}
        </div>
      </IdentityPrompt>
    </section>
  );
}
