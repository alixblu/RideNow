/**
 * StatusPill — a colored badge for Trip / Payment / Driver statuses.
 *
 * Maps each known status string to a semantic tone (success/warning/danger/info/
 * neutral). Unknown values fall back to neutral, so it is safe to pass any status
 * string. Purely presentational — it renders the status text as given.
 */
import { cn } from "./cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

// The dot carries the tone; the label stays in muted ink. Quieter than a filled pill.
const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-content-subtle",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

// Status -> tone. Covers Trip_Status, Payment_Status, and Driver/Vehicle states.
const STATUS_TONE: Record<string, Tone> = {
  // Trip
  REQUESTED: "info",
  SEARCHING: "warning",
  DRIVER_ASSIGNED: "info",
  DRIVER_ARRIVED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  // Payment
  PENDING: "warning",
  PROCESSING: "info",
  PAID: "success",
  FAILED: "danger",
  // Driver
  ACTIVE: "success",
  SUSPENDED: "danger",
};

interface StatusPillProps {
  status: string;
  className?: string;
}

/** Humanize an ENUM_LIKE status for display (e.g. DRIVER_ASSIGNED -> "Driver assigned"). */
function humanize(status: string): string {
  const lower = status.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function StatusPill({ status, className }: StatusPillProps) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-muted",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", DOT_CLASS[tone])} aria-hidden="true" />
      {humanize(status)}
    </span>
  );
}
