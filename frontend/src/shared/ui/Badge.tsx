/**
 * Badge — a tinted pill for a status. Replaces StatusPill for new screens.
 *
 * `status` maps to a tone (success, warning, danger, neutral); unknown values are
 * neutral. Pass `tone` to force one. Text stays in the content color so it keeps
 * 4.5:1 contrast on the tinted background.
 */
import { cn } from "./cn";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "bg-success/15",
  warning: "bg-warning/15",
  danger: "bg-danger/15",
  neutral: "bg-surface-raised",
};

const DOT_CLASS: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-content-subtle",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-content",
        TONE_CLASS[resolved],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[resolved])} aria-hidden="true" />
      {label}
    </span>
  );
}
