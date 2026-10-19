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
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  leftIcon?: ReactNode;
  /** When true, shows an inline spinner and disables the button. */
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-accent/50 disabled:text-accent-fg/70",
  secondary:
    "bg-transparent text-content border border-border hover:bg-surface-raised disabled:opacity-50",
  ghost:
    "bg-transparent text-content-muted hover:text-content hover:bg-surface-raised disabled:opacity-40",
  danger:
    "bg-transparent text-danger border border-danger/40 hover:bg-danger/10 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-lg",
  md: "h-10 px-4 text-sm rounded-lg",
  lg: "h-11 px-5 text-[0.95rem] rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    block = false,
    leftIcon,
    loading = false,
    className,
    children,
    type,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors",
        "disabled:cursor-not-allowed select-none",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : leftIcon ? (
        <span className="shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
