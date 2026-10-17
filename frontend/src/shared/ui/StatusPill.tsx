/**
 * StatusPill — a colored badge for Trip / Payment / Driver statuses.
 *
 * Maps each known status string to a semantic tone (success/warning/danger/info/
 * neutral). Unknown values fall back to neutral, so it is safe to pass any status
 * string. Purely presentational — it renders the status text as given.
 */
import { cn } from "./cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-content/10 text-content-muted",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {humanize(status)}
    </span>
  );
}
