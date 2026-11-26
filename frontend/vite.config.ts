import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { buildProxy } from "./proxy";

// Single Vite config covering dev/build and the Vitest test runner.
// The app builds and runs standalone, with no backend service required (Req 1.5).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // The backend services send no CORS headers, so a browser on :5173 cannot call
      // them directly. With VITE_API_BASE_URL=http://localhost:5173 every request goes
      // to this dev server, which forwards it by path to the owning service, or to
      // VITE_PROXY_TARGET (e.g. the ALB) when that is set.
      proxy: buildProxy(env.VITE_PROXY_TARGET),
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}", "proxy.test.ts"],
      // Iteration-heavy React Router DOM property tests (AppShell.navigation,
      // routes.notfound) render full component trees across many fast-check runs
      // and can exceed the 5s default under full-suite parallel load, though they
      // pass in isolation. Raise the per-test/hook timeout for deterministic runs
      // (Req 1.5).
      testTimeout: 20000,
      // Unit tests never reach a backend: the notification inbox (live by default)
      // uses its in-memory mock under test.
      env: { VITE_CLIENT_NOTIFICATION: "mock" },
      hookTimeout: 20000,
    },
  };
});
