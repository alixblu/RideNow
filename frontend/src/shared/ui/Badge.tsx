/**
 * Badge — a tinted pill for a status. Replaces StatusPill for new screens.
 *
 * `status` maps to a tone (success, warning, danger, neutral); unknown values are
 * neutral. Pass `tone` to force one (including `brand`). Each tone keeps 4.5:1
 * text contrast on its background in both themes.
 */
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

/**
 * Background + text per tone, from the scale tokens. Light uses the 100 step with the
 * 800 step text; dark uses the (dark) 100 step with the 300 step text. All pairs are
 * at least 4.5:1 in both themes.
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-content",
  brand: "bg-accent-muted text-brand-700 dark:text-brand-300",
  success: "bg-success-100 text-success-800 dark:text-success-300",
  warning: "bg-warning-100 text-warning-800 dark:text-warning-300",
  danger: "bg-danger-100 text-danger-800 dark:text-danger-300",
};

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-content-subtle",
  brand: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  COMPLETED: "success",
  PAID: "success",
  ACTIVE: "success",
  ONLINE: "success",
  REQUESTED: "warning",
  SEARCHING: "warning",
  DRIVER_ASSIGNED: "warning",
  DRIVER_ARRIVED: "warning",
  IN_PROGRESS: "warning",
  PENDING: "warning",
  PROCESSING: "warning",
  AUTHORIZED: "warning",
  CANCELLED: "danger",
  FAILED: "danger",
  SUSPENDED: "danger",
  RELEASED: "neutral",
  OFFLINE: "neutral",
};

export function toneForStatus(status: string): BadgeTone {
  return STATUS_TONE[status] ?? "neutral";
}

function humanize(status: string): string {
  const lower = status.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

interface BadgeProps {
  /** ENUM_LIKE status; rendered humanized unless `children` is given. */
  status?: string;
  tone?: BadgeTone;
  children?: string;
  className?: string;
}

export function Badge({ status, tone, children, className }: BadgeProps) {
  const resolved = tone ?? (status ? toneForStatus(status) : "neutral");
  const label = children ?? (status ? humanize(status) : "");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[resolved],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[resolved])} aria-hidden="true" />
      {label}
    </span>
  );
}
