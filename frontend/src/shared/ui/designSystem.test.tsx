/**
 * Unit tests for the Design_System: token contrast, BottomSheet snap cycling,
 * Skeleton / EmptyState rendering, and the PhoneColumn max-width class.
 * Validates: Requirements 3.3, 3.5, 3.7, 3.9, 4.11
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BottomSheet, nextSnap } from "./BottomSheet";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { PhoneColumn } from "../layout/PhoneColumn";


const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

function themeTokens(selector: RegExp): Record<string, [number, number, number]> {
  const block = css.match(selector)?.[1] ?? "";
  const out: Record<string, [number, number, number]> = {};
  for (const m of block.matchAll(/--rn-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function luminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("Design_System token contrast (Req 3.5)", () => {
  const light = themeTokens(/:root,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/);
  const dark = themeTokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const themes = { light, dark };

  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text tokens reach 4.5:1 on bg and surface`, () => {
      for (const text of ["content", "content-muted", "content-subtle"]) {
        for (const bg of ["bg", "surface"]) {
          expect(t[text], text).toBeDefined();
          expect(t[bg], bg).toBeDefined();
          expect(contrast(t[text]!, t[bg]!), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name}: accent-fg reaches 4.5:1 on accent`, () => {
      expect(contrast(t["accent-fg"]!, t["accent"]!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("BottomSheet snap cycling (Req 3.3)", () => {
  it("nextSnap cycles peek -> half -> full -> peek", () => {
    expect(nextSnap("peek")).toBe("half");
    expect(nextSnap("half")).toBe("full");
    expect(nextSnap("full")).toBe("peek");
  });

  it("handle button cycles snap points via keyboard activation", () => {
    render(
      <BottomSheet label="Trip panel" defaultSnap="peek">
        <p>content</p>
      </BottomSheet>,
    );
    const sheet = screen.getByRole("region", { name: "Trip panel" });
    const handle = screen.getByRole("button", { name: /resize panel/i });
    expect(sheet.getAttribute("data-snap")).toBe("peek");
    handle.focus();
    expect(document.activeElement).toBe(handle);
    // Native buttons turn Enter/Space into click; jsdom does not, so click is the activation.
    fireEvent.click(handle);
    expect(sheet.getAttribute("data-snap")).toBe("half");
    fireEvent.click(handle);
    expect(sheet.getAttribute("data-snap")).toBe("full");
    fireEvent.click(handle);
    expect(sheet.getAttribute("data-snap")).toBe("peek");
  });

  it("handle is a real button with a 44px minimum height", () => {
    render(
      <BottomSheet label="Panel">
        <p>x</p>
      </BottomSheet>,
    );
    const handle = screen.getByRole("button", { name: /resize panel/i });
    expect(handle.tagName).toBe("BUTTON");
    expect(handle.className).toContain("min-h-11");
  });

  it("controlled mode reports the next snap without changing itself", () => {
    const seen: string[] = [];
    render(
      <BottomSheet label="Panel" snap="half" onSnapChange={(s) => seen.push(s)}>
        <p>x</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: /resize panel/i }));
    expect(seen).toEqual(["full"]);
    expect(screen.getByRole("region", { name: "Panel" }).getAttribute("data-snap")).toBe("half");
  });
});

describe("Skeleton and EmptyState (Req 3.7, 3.9)", () => {
  it("Skeleton renders a hidden placeholder that takes the given dimensions", () => {
    const { container } = render(<Skeleton className="h-16 w-full" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("h-16");
    expect(el.className).toContain("w-full");
  });

  it("EmptyState shows the message, a default icon, and the action", () => {
    const { container } = render(
      <EmptyState message="No trips yet" action={<button type="button">Book a ride</button>} />,
    );
    expect(screen.getByText("No trips yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Book a ride" })).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("EmptyState renders a custom icon instead of the default", () => {
    const { container } = render(
      <EmptyState message="Empty" icon={<span data-testid="custom-icon" />} />,
    );
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("PhoneColumn (Req 4.11)", () => {
  it("applies the 480px max-width, centering and full-width classes", () => {
    render(
      <PhoneColumn>
        <p>child</p>
      </PhoneColumn>,
    );
    const col = screen.getByTestId("phone-column");
    expect(col.className).toContain("max-w-[480px]");
    expect(col.className).toContain("mx-auto");
    expect(col.className).toContain("w-full");
    expect(screen.getByText("child")).toBeTruthy();
  });
});
