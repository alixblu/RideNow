import type { Config } from "tailwindcss";

/**
 * Tailwind configuration for the RideNow frontend.
 *
 * The ride-hailing visual language is expressed as semantic color tokens that resolve
 * to CSS variables (defined in src/index.css) so the same class names theme cleanly
 * between the light base and the dark variant. Dark mode is driven by a
 * `data-theme="dark"` attribute on <html> (toggled by the ThemeToggle).
 */
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
        border: "rgb(var(--rn-border) / <alpha-value>)",
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
        success: "rgb(var(--rn-success) / <alpha-value>)",
        warning: "rgb(var(--rn-warning) / <alpha-value>)",
        danger: "rgb(var(--rn-danger) / <alpha-value>)",
        info: "rgb(var(--rn-info) / <alpha-value>)",
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
      boxShadow: {
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
