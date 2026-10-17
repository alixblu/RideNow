/**
 * DriverDetailView — renders ALL fields of a `DriverResponse` (Req 5.3) plus the
 * status-change control restricted to ACTIVE/SUSPENDED (Req 7.1, 7.2).
 *
 * Presentational: it takes a driver object and a status-change handler, so both the
 * create-driver success view and the driver-lookup view reuse it. The status control is
 * a segmented ACTIVE/SUSPENDED toggle whose options come solely from
 * `DRIVER_STATUS_VALUES`, so only the two allowed Driver_Status values are offered
 * (Req 7.1). Restyled on the Tailwind kit.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { DRIVER_STATUS_VALUES } from "../../shared/enums";
import type { DriverStatus } from "../../shared/enums";
import type { DriverResponse } from "../../domain/driver";
import { Button, StatusPill, cn } from "../../shared/ui";

interface DriverDetailViewProps {
  driver: DriverResponse;
  onChangeStatus: (status: DriverStatus) => void;
  changing?: boolean;
}

function renderNullable(value: string | number | null): string {
  return value === null ? "—" : String(value);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <dt className="text-sm text-content-subtle">{label}</dt>
      <dd className="text-sm text-content text-right break-all">{value}</dd>
    </div>
  );
}

export function DriverDetailView({
  driver,
  onChangeStatus,
  changing = false,
}: DriverDetailViewProps) {
  const [selected, setSelected] = useState<DriverStatus>(driver.status);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Driver</h3>
        <StatusPill status={driver.status} />
      </div>

      <dl className="mt-3">
        <Row label="ID" value={driver.id} />
        <Row label="User ID" value={driver.userId} />
        <Row label="License number" value={driver.licenseNumber} />
        <Row label="Average rating" value={renderNullable(driver.averageRating)} />
        <Row label="Total trips" value={driver.totalTrips} />
        <Row label="Created at" value={driver.createdAt} />
        <Row label="Updated at" value={driver.updatedAt} />
      </dl>

      <div className="mt-4">
        <label htmlFor="driver-status" className="text-sm font-medium text-content">
          Change status
        </label>
        <div className="mt-2 flex items-center gap-2">
          {/* Segmented toggle; a hidden-but-labeled select preserves the accessible
              "Change status" control and the DRIVER_STATUS_VALUES option set. */}
          <div
            role="group"
            aria-label="Change status"
            className="flex rounded-xl border border-border bg-surface p-1"
          >
            {DRIVER_STATUS_VALUES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={selected === status}
                onClick={() => setSelected(status)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  selected === status
                    ? "bg-accent text-accent-fg"
                    : "text-content-muted hover:text-content",
                )}
              >
                {status}
              </button>
            ))}
          </div>
          <select
            id="driver-status"
            className="sr-only"
            value={selected}
            onChange={(e) => setSelected(e.target.value as DriverStatus)}
            tabIndex={-1}
            aria-hidden="true"
          >
            {DRIVER_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={changing || selected === driver.status}
            onClick={() => onChangeStatus(selected)}
          >
            {changing ? "Updating…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
