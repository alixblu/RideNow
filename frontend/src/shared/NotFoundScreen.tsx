/**
 * NotFoundScreen — catch-all view. Its single navigation control targets
 * `homeRouteFor(identity)`: the Role's home when signed in, else `/sign-in` (Req 1.6).
 */
import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { homeRouteFor } from "../identity/guard";
import { useCurrentIdentity } from "../identity/useCurrentIdentity";

export function NotFoundScreen() {
  const { identity } = useCurrentIdentity();
  const target = homeRouteFor(identity);
  return (
    <main
      role="alert"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <Compass className="h-10 w-10 text-content-subtle" aria-hidden="true" />
      <div>
        <h1 className="text-2xl font-extrabold text-content">Page not found</h1>
        <p className="mt-1 text-sm text-content-muted">The page you requested does not exist.</p>
      </div>
      <Link
        to={target}
        className="inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg"
      >
        {identity ? "Go to home" : "Go to sign in"}
      </Link>
    </main>
  );
}
