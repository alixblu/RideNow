import type { Config } from "tailwindcss";

/**
 * Tailwind configuration for the RideNow frontend.
 *
 * The ride-hailing visual language is expressed as semantic color tokens that resolve
 * to CSS variables (defined in src/index.css) so the same class names theme cleanly
 * between the light base and the dark variant. Dark mode is driven by a
 * `data-theme="dark"` attribute on <html> (toggled by the ThemeToggle).
 */
const rgbVar = (name: string) => `rgb(var(--rn-${name}) / <alpha-value>)`;

/** Nested color object keyed by step, e.g. brand-600 -> rgb(var(--rn-brand-600) / <alpha-value>). */
const scale = (name: string, steps: readonly number[], withDefault?: number) => {
  const out: Record<string, string> = {};
  for (const s of steps) out[String(s)] = rgbVar(`${name}-${s}`);
  if (withDefault !== undefined) out.DEFAULT = rgbVar(name);
  return out;
};

const STEPS_10 = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const STEPS_12 = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces/text resolve to CSS variables for light/dark theming.
        bg: "rgb(var(--rn-bg) / <alpha-value>)",
        surface: "rgb(var(--rn-surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--rn-surface-raised) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--rn-border) / <alpha-value>)",
          strong: "rgb(var(--rn-border-strong) / <alpha-value>)",
        },
        "surface-sunken": "rgb(var(--rn-surface-sunken) / <alpha-value>)",
        "border-strong": "rgb(var(--rn-border-strong) / <alpha-value>)",
        "accent-muted": "rgb(var(--rn-accent-muted) / <alpha-value>)",
        scrim: "rgb(var(--rn-scrim) / <alpha-value>)",
        brand: scale("brand", STEPS_10),
        neutral: scale("neutral", STEPS_12),
        content: {
          DEFAULT: "rgb(var(--rn-content) / <alpha-value>)",
          muted: "rgb(var(--rn-content-muted) / <alpha-value>)",
          subtle: "rgb(var(--rn-content-subtle) / <alpha-value>)",
          inverse: "rgb(var(--rn-content-inverse) / <alpha-value>)",
        },
        // The brand green accent.
        accent: {
          DEFAULT: "rgb(var(--rn-accent) / <alpha-value>)",
          hover: "rgb(var(--rn-accent-hover) / <alpha-value>)",
          fg: "rgb(var(--rn-accent-fg) / <alpha-value>)",
        },
        // Warm secondary highlight.
        sand: "rgb(var(--rn-sand) / <alpha-value>)",
        // Status palette.
        success: scale("success", STEPS_10, 1),
        warning: scale("warning", STEPS_10, 1),
        danger: scale("danger", STEPS_10, 1),
        info: scale("info", STEPS_10, 1),
      },
      borderRadius: {
        // Large rounded cards: `xl` (1rem = 16px) is the minimum card radius.
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      fontFamily: {
        // Single bold sans-serif family.
        sans: [
          "Inter Variable",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        display: ["2.25rem", { lineHeight: "2.75rem" }],
        heading: ["1.75rem", { lineHeight: "2.25rem" }],
        title: ["1.25rem", { lineHeight: "1.75rem" }],
        body: ["1rem", { lineHeight: "1.5rem" }],
        label: ["0.875rem", { lineHeight: "1.25rem" }],
        caption: ["0.75rem", { lineHeight: "1rem" }],
      },
      transitionDuration: {
        press: "80ms",
        fast: "120ms",
        base: "200ms",
        slow: "360ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
      },
      boxShadow: {
        inset: "inset 0 1px 2px rgb(0 0 0 / 0.04)",
        card: "0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.06)",
        pop: "0 10px 30px rgb(0 0 0 / 0.22)",
        sheet: "0 -8px 32px rgb(0 0 0 / 0.16)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.6" },
          "80%, 100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
        shimmer: "shimmer 1.4s infinite",
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
