/**
 * App — the App_Shell composition root.
 *
 * Owns the two cross-cutting providers every screen depends on and that must wrap
 * ANY render of <App/> (production and tests alike):
 *   - QueryClientProvider (TanStack Query) so the rider/admin/driver screens' useQuery
 *     / useMutation hooks have a client. Tests render <App/> under a bare MemoryRouter
 *     (no provider of their own), so App MUST supply the QueryClient itself — otherwise
 *     those hooks throw "No QueryClient set".
 *   - DevIdentityProvider mounted ABOVE the route table so it sits outside every area
 *     subtree: navigating between Rider, Driver, and Admin never unmounts it and the
 *     Current_Identity selection is preserved across areas (Req 1.3). The provider also
 *     renders the Identity_Switcher chrome at the top of the page.
 *
 * Routing is supplied from OUTSIDE this component: main.tsx wraps <App/> in a
 * BrowserRouter in production, while tests wrap it in a MemoryRouter. App therefore
 * renders no router of its own and just emits the route table (`AppRoutes`), whose `/`
 * element is the `AppShell` chrome (nav + active-area indicator + <Outlet/>) with
 * nested rider/driver/admin subtrees and a catch-all not-found route.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DevIdentityProvider } from "./identity/DevIdentityProvider";
import { ToastProvider } from "./shared/ui";
import { AppRoutes } from "./routes";

// One app-wide QueryClient, created once at module load. Every <App/> render shares
// it, which is what gives test renders a client without the test wiring one up.
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DevIdentityProvider>
          <AppRoutes />
        </DevIdentityProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
