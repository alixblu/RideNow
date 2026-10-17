/**
 * Button — the primary interactive control, Uber-style.
 *
 * Variants:
 *   - primary: bold accent fill (default call-to-action)
 *   - secondary: surface fill with border
 *   - ghost: transparent, for low-emphasis actions
 *   - danger: destructive actions
 * Sizes: sm | md | lg, plus an optional `block` for full-width.
 *
 * It is a thin wrapper over a native <button>, so every native prop (type, disabled,
 * onClick, aria-*) passes through and tests keep querying by role/name as before.
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  leftIcon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-accent/50 disabled:text-accent-fg/70",
  secondary:
    "bg-surface-raised text-content border border-border hover:border-content-subtle disabled:opacity-50",
  ghost:
    "bg-transparent text-content hover:bg-surface-raised disabled:opacity-40",
  danger:
    "bg-danger text-white hover:brightness-110 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-12 px-5 text-base rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block = false, leftIcon, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors",
        "disabled:cursor-not-allowed select-none",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {leftIcon ? <span className="shrink-0" aria-hidden="true">{leftIcon}</span> : null}
      {children}
    </button>
  );
});
