/**
 * Input and Select — themed form controls.
 *
 * Both are thin wrappers over their native elements so every native prop (id, value,
 * onChange, aria-*, disabled) passes through unchanged and existing tests that query
 * by label/role keep working. An `invalid` flag applies the danger border.
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const FIELD_BASE =
  "w-full h-11 px-3.5 rounded-xl bg-surface-raised text-content placeholder:text-content-subtle " +
  "border border-border transition-colors focus:border-accent disabled:opacity-50";

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
      className={cn(FIELD_BASE, invalid && "border-danger focus:border-danger", className)}
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
        invalid && "border-danger focus:border-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
