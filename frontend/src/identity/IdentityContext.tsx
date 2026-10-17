/**
 * IdentityContext — the React context that carries the IdentityApi implementation.
 *
 * This is the seam of the replaceable module boundary (Req 2.5). Whatever provider
 * is mounted above the router (today `DevIdentityProvider`, later a real auth
 * provider) supplies an `IdentityApi` through this context. Screens never read the
 * context directly; they go through `useCurrentIdentity()`, which keeps the context
 * swappable without touching callers.
 *
 * The default is `null` so that `useCurrentIdentity()` can fail loudly when no
 * provider is mounted, rather than silently handing back a non-functional api.
 */
import { createContext } from "react";
import type { IdentityApi } from "./types";

export const IdentityContext = createContext<IdentityApi | null>(null);
