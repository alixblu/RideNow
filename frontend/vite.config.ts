import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Single Vite config covering dev/build and the Vitest test runner.
// The app builds and runs standalone, with no backend service required (Req 1.5).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Iteration-heavy React Router DOM property tests (AppShell.navigation,
    // routes.notfound) render full component trees across many fast-check runs
    // and can exceed the 5s default under full-suite parallel load, though they
    // pass in isolation. Raise the per-test/hook timeout for deterministic runs
    // (Req 1.5).
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
