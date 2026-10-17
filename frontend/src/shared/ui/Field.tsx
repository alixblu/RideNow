/**
 * Field — label + control + optional hint/error wrapper for forms.
 *
 * Associates a visible <label> with its control via `htmlFor`/`id`, renders an
 * optional hint, and renders a field-level error with role="alert" when `error` is
 * set (the markup validation tests rely on this role). Pass the control as children
 * with a matching `id`.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

interface FieldProps {
  /** Control id, wired to the label's htmlFor. */
  htmlFor: string;
  label: string;
  /** Marks the label with a required asterisk. */
  required?: boolean | undefined;
  hint?: string | undefined;
  /** Field-level error message; rendered with role="alert" when present. */
  error?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function Field({
  htmlFor,
  label,
  required,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1 text-sm font-medium text-content">
        {/* The <label> text content is exactly `label` so getByLabelText(label)
            matches; the required marker sits outside the label as decoration. */}
        <label htmlFor={htmlFor}>{label}</label>
        {required ? (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
      {children}
      {hint && !error ? (
        <span className="text-xs text-content-subtle">{hint}</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
