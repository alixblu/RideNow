/**
 * Property 2: Badge tones meet WCAG AA contrast in both themes.
 * The domain is finite (5 tones x 2 themes), so it is checked exhaustively.
 * Each rendered tone's Tailwind classes are resolved to tokens in index.css.
 * **Validates: Requirements 4.2**
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Badge, type BadgeTone } from "./Badge";

type RGB = [number, number, number];

const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

function themeTokens(selector: RegExp): Record<string, RGB> {
  const block = css.match(selector)?.[1] ?? "";
  const out: Record<string, RGB> = {};
  for (const m of block.matchAll(/--rn-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function luminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TONES: BadgeTone[] = ["neutral", "brand", "success", "warning", "danger"];
const themes = {
  light: themeTokens(/:root,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/),
  dark: themeTokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
};

/** Token names for the badge's background and text in the given theme. */
function resolveTone(tone: BadgeTone, theme: "light" | "dark"): { bg: string; text: string } {
  const { container } = render(<Badge tone={tone}>Label</Badge>);
  const classes = (container.firstElementChild as HTMLElement).className.split(/\s+/);
  const bg = classes.find((c) => c.startsWith("bg-"))?.slice(3);
  const plain = classes.find((c) => c.startsWith("text-") && !c.startsWith("text-xs"))?.slice(5);
  const dark = classes.find((c) => c.startsWith("dark:text-"))?.slice(10);
  const text = theme === "dark" ? (dark ?? plain) : plain;
  if (!bg || !text) throw new Error(`Cannot resolve ${tone} classes: ${classes.join(" ")}`);
  return { bg, text };
}

describe("Property 2: Badge tones meet 4.5:1 contrast in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const tone of TONES) {
      it(`${tone} in ${theme}`, () => {
        const { bg, text } = resolveTone(tone, theme);
        const t = themes[theme];
        expect(t[bg], `token ${bg}`).toBeDefined();
        expect(t[text], `token ${text}`).toBeDefined();
        expect(contrast(t[text]!, t[bg]!), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
