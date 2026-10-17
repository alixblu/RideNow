/**
 * ThemeToggle — switches between the dark (default) and light themes.
 *
 * The active theme is stored on <html data-theme> and persisted to localStorage under
 * "rn-theme"; an inline script in index.html applies it before paint to avoid a flash.
 * This control just flips the attribute and the stored value. Dark is the fallback.
 */
import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./Button";

type Theme = "dark" | "light";

const STORAGE_KEY = "rn-theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures (private mode, etc.); the attribute still applies.
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  // Keep local state in sync if the attribute was set before mount.
  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="px-2"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
