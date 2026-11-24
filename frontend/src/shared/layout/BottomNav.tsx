/**
 * BottomNav — bottom tab bar built on NavLink.
 * NavLink sets aria-current="page" on the active item; each target is at least 44 px.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../ui/cn";

export interface BottomNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  /** Match only the exact path (use for index routes like /rider). */
  end?: boolean;
}

interface BottomNavProps {
  items: BottomNavItem[];
  label?: string;
  className?: string;
}

export function BottomNav({ items, label = "Primary", className }: BottomNavProps) {
  return (
    <nav
      aria-label={label}
      className={cn("shrink-0 border-t border-border bg-surface", className)}
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end ?? true}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-xs font-medium transition-colors",
                  isActive ? "text-accent" : "text-content-muted hover:text-content",
                )
              }
            >
              {item.icon ? (
                <span aria-hidden="true" className="shrink-0">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
