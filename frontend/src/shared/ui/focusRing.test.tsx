/**
 * Property 14: every interactive Primitive shows a focus ring that meets 3:1
 * contrast in both themes. The domain is finite (6 controls x 2 themes x 3
 * backgrounds), so it is checked exhaustively.
 * **Validates: Requirements 2.4**
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { Input, Select } from "./Input";
import { ThemeToggle } from "./ThemeToggle";
import { BottomSheet } from "./BottomSheet";
import { ToastProvider, useToast } from "./toast";
import { useEffect } from "react";

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

const themes = {
  light: themeTokens(/:root,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/),
  dark: themeTokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
};

/** The global `:focus-visible { ... }` rule body from index.css, if any. */
const globalRule = css.match(/(?<![\w-]):focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
const globalRingToken = globalRule.match(/(?<![\w:-])ring-(?!offset|\d)([a-z0-9-]+)/)?.[1];
const globalHasRing = /(?<![\w:-])ring-2\b/.test(globalRule) && globalRingToken !== undefined;

function ToastWithItem() {
  const { toast } = useToast();
  useEffect(() => {
    toast("Hello", "info");
  }, [toast]);
  return null;
}

const controls: Record<string, () => HTMLElement> = {
  Button: () => {
    render(<Button>Go</Button>);
    return screen.getByRole("button", { name: "Go" });
  },
  Input: () => {
    render(<Input aria-label="name" />);
    return screen.getByRole("textbox", { name: "name" });
  },
  Select: () => {
    render(
      <Select aria-label="kind">
        <option>a</option>
      </Select>,
    );
    return screen.getByRole("combobox", { name: "kind" });
  },
  ThemeToggle: () => {
    render(<ThemeToggle />);
    return screen.getByRole("button", { name: /switch to/i });
  },
  "BottomSheet handle": () => {
    render(
      <BottomSheet label="sheet">
        <p>content</p>
      </BottomSheet>,
    );
    return screen.getByRole("button", { name: /resize panel/i });
  },
  "toast dismiss": () => {
    render(
      <ToastProvider>
        <ToastWithItem />
      </ToastProvider>,
    );
    return screen.getByRole("button", { name: "Dismiss notification" });
  },
};

/** Ring color token used when the control is focused, or undefined if no ring. */
function ringToken(el: HTMLElement): string | undefined {
  const classes = el.className.split(/\s+/);
  const own = classes.find((c) => /^(focus|focus-visible):ring-(?!offset|\d)/.test(c));
  if (own) return own.replace(/^(focus|focus-visible):ring-/, "");
  const ownRing = classes.some((c) => /^(focus|focus-visible):ring(-\d+)?$/.test(c));
  const suppressed = classes.some((c) => /^(focus|focus-visible)?:?outline-none$/.test(c));
  if (suppressed && !ownRing) return undefined; // outline removed with no ring
  return globalHasRing ? globalRingToken : undefined;
}

describe("global :focus-visible rule", () => {
  it("defines a 2px ring in index.css", () => {
    expect(globalHasRing).toBe(true);
  });
});

describe("Property 14: focus ring present and >= 3:1 in both themes", () => {
  for (const [name, make] of Object.entries(controls)) {
    for (const theme of ["light", "dark"] as const) {
      it(`${name} in ${theme}`, () => {
        const el = make();
        const token = ringToken(el);
        expect(token, `${name} has no focus ring`).toBeDefined();
        const t = themes[theme];
        const ring = t[token!];
        expect(ring, `token ${token}`).toBeDefined();
        for (const bg of ["bg", "surface", "surface-raised"]) {
          expect(contrast(ring!, t[bg]!), `${token} on ${bg}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
