/**
 * Input and Select — themed 48 px form controls.
 *
 * Thin wrappers over native elements so every native prop passes through unchanged.
 * An `invalid` flag applies the danger ring. Pair with `Field` for label and error
 * text. Controls use a filled surface instead of a hairline border.
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const FIELD_BASE =
  "w-full h-12 px-4 rounded-xl bg-surface-raised text-content placeholder:text-content-subtle " +
  "border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-accent " +
  "focus:border-accent disabled:opacity-50";

const INVALID = "border-danger focus:border-danger focus:ring-danger";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cn(FIELD_BASE, invalid && INVALID, className)}
      {...rest}
    />
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        FIELD_BASE,
        "appearance-none cursor-pointer",
        invalid && INVALID,
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
