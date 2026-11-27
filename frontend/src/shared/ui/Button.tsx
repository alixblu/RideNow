/**
 * Button — the primary interactive control.
 *
 * Variants: primary | secondary | ghost | danger. Sizes: sm | md | lg, plus `block`
 * for full-width. Touch targets: every button is at least 44x44 CSS px when it sits
 * inside an ancestor marked `data-touch` (the Rider and Driver layouts) or when
 * `touch` is set explicitly (Req 3.4). `lg` is always 44 px or taller.
 *
 * It is a thin wrapper over a native <button>, so every native prop passes through.
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
  /** Forces the 44 px minimum touch target regardless of ancestor context. */
  touch?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-card hover:bg-accent-hover disabled:bg-accent/50 disabled:text-accent-fg/70 disabled:shadow-none",
  secondary:
    "bg-surface-raised text-content border border-border hover:bg-border hover:border-border-strong disabled:opacity-50",
  ghost:
    "bg-transparent text-content-muted hover:text-content hover:bg-surface-raised disabled:opacity-40",
  danger:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-xl",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-12 px-5 text-base rounded-xl",
};

const TOUCH_CONTEXT = "[[data-touch]_&]:min-h-11 [[data-touch]_&]:min-w-11";
const TOUCH_FORCED = "min-h-11 min-w-11";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    block = false,
    leftIcon,
    loading = false,
    touch = false,
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
        "inline-flex items-center justify-center gap-2 font-semibold",
        "transition-transform duration-press ease-standard",
        "active:scale-[0.98] active:brightness-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:brightness-100 select-none",
        VARIANTS[variant],
        SIZES[size],
        touch ? TOUCH_FORCED : TOUCH_CONTEXT,
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
