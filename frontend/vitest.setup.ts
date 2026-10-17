// Vitest global setup: extends `expect` with jest-dom matchers and
// cleans up the React DOM after each test.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
