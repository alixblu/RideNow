/**
 * App — the App_Shell composition root.
 *
 * Owns the two cross-cutting providers every screen depends on and that must wrap
 * ANY render of <App/> (production and tests alike):
 *   - QueryClientProvider (TanStack Query) so the rider/admin/driver screens' useQuery
 *     / useMutation hooks have a client. Tests render <App/> under a bare MemoryRouter
 *     (no provider of their own), so App MUST supply the QueryClient itself — otherwise
 *     those hooks throw "No QueryClient set".
 *   - SessionIdentityProvider mounted ABOVE the route table so the persisted Session is
 *     restored on first render and survives navigation between areas.
 *
 * Routing is supplied from OUTSIDE this component: main.tsx wraps <App/> in a
 * BrowserRouter in production, while tests wrap it in a MemoryRouter. App renders no
 * router of its own and just emits the route table (`AppRoutes`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionIdentityProvider } from "./identity/SessionIdentityProvider";
import { ToastProvider } from "./shared/ui";
import { AppRoutes } from "./routes";

// One app-wide QueryClient, created once at module load. Every <App/> render shares
// it, which is what gives test renders a client without the test wiring one up.
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionIdentityProvider>
          <AppRoutes />
        </SessionIdentityProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
