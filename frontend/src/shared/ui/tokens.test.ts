import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

const root = resolve(__dirname, "../../..");
const indexCss = readFileSync(resolve(root, "src/index.css"), "utf8");

/** Reads the font-face CSS of the self-hosted font that index.css imports. */
function fontCss(): string {
  const match = indexCss.match(/@import\s+["']([^"']*fontsource[^"']*)["']/);
  expect(match, "index.css imports a self-hosted fontsource package").not.toBeNull();
  return readFileSync(resolve(root, "node_modules", match![1]!, "index.css"), "utf8");
}

const ms = (v: string) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(v);
  expect(m, `duration "${v}" is in ms or s`).not.toBeNull();
  return m![2] === "s" ? parseFloat(m![1]!) * 1000 : parseFloat(m![1]!);
};

describe("design tokens", () => {
  it("font setup uses font-display: swap (Req 3.2)", () => {
    const css = indexCss.includes("@font-face") ? indexCss + fontCss() : fontCss();
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });

  it("index.css defines a prefers-reduced-motion rule (Req 7.3)", () => {
    expect(indexCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("motion tokens stay within bounds (Req 10.1, 7.2)", () => {
    const d = config.theme?.extend?.transitionDuration as Record<string, string>;
    expect(ms(d.press!)).toBeLessThan(100);
    for (const key of ["fast", "base", "slow"]) {
      const v = ms(d[key]!);
      expect(v, key).toBeGreaterThanOrEqual(100);
      expect(v, key).toBeLessThanOrEqual(400);
    }
  });
});
