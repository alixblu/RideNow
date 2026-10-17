/**
 * Application entry point.
 *
 * Supplies the one provider that is environment-specific — the router. In production
 * that is a `BrowserRouter`; in tests the suite wraps `<App/>` in a `MemoryRouter`
 * instead. Everything else that every screen depends on (the TanStack Query
 * `QueryClientProvider` and the `DevIdentityProvider`) lives INSIDE `App.tsx` so any
 * render of `<App/>`, including test renders under a bare `MemoryRouter`, has a
 * QueryClient and an identity context.
 *
 * This keeps main.tsx minimal (Req 1.5: build and run standalone): it only mounts the
 * router and the app.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
