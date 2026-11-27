import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Property 13: No hard-coded color utility remains in screen-level source
 * outside the map pin constants.
 *
 * **Validates: Requirements 8.2**
 */
const srcRoot = resolve(__dirname, "../..");

/** TripMap.tsx keeps documented pin color constants, so it is excluded. */
const EXCLUDED_FILES = new Set(["map/TripMap.tsx"]);

/**
 * Documented exceptions: file -> allowed offending substring.
 * Avatar draws white initials on a computed (non-token) background color.
 */
const ALLOWED: Record<string, string[]> = {
  "shared/ui/Avatar.tsx": ["text-white"],
};

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;
const PALETTE =
  "white|black|gray|grey|slate|zinc|neutral-\\d+|stone|red|green|blue|yellow|orange|amber|emerald|rose|indigo|sky|teal|cyan|lime|pink|purple|violet|fuchsia";
const COLOR_UTILITY = new RegExp(
  `\\b(?:bg|text|border|ring|from|to|via|divide|fill|stroke|outline|placeholder|shadow|decoration|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
  "g",
);

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      collectTsx(full, out);
    } else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function findings(): string[] {
  const result: string[] = [];
  for (const file of collectTsx(srcRoot)) {
    const rel = relative(srcRoot, file).split(sep).join("/");
    if (EXCLUDED_FILES.has(rel)) continue;
    const allowed = ALLOWED[rel] ?? [];
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const hits = [...(line.match(HEX_LITERAL) ?? []), ...(line.match(COLOR_UTILITY) ?? [])];
        for (const hit of hits) {
          if (allowed.includes(hit)) continue;
          result.push(`${rel}:${i + 1}: ${hit}`);
        }
      });
  }
  return result;
}

describe("Property 13: no hard-coded colors in screen-level source", () => {
  it("scans the apps, auth and shared directories", () => {
    const files = collectTsx(srcRoot).map((f) => relative(srcRoot, f).split(sep).join("/"));
    for (const dir of ["apps/", "auth/", "shared/"]) {
      expect(files.some((f) => f.startsWith(dir)), `${dir} has .tsx files`).toBe(true);
    }
  });

  it("finds no hex literals or palette color utilities (Avatar text-white is allowed)", () => {
    expect(findings()).toEqual([]);
  });

  it("detects offenders, so the scan is not vacuous", () => {
    expect('className="bg-white text-gray-500 border-black"'.match(COLOR_UTILITY)).toHaveLength(3);
    expect('fill="#fff"'.match(HEX_LITERAL)).toHaveLength(1);
    expect("bg-surface text-fg border-border".match(COLOR_UTILITY)).toBeNull();
  });
});
