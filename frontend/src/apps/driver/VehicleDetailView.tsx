/**
 * VehicleDetailView — renders a single `VehicleResponse` with every contract field:
 * plate number, Vehicle_Type, brand, model, color, and active state (Req 6.5).
 * Restyled on the Tailwind kit.
 */
import type { ReactNode } from "react";
import type { VehicleResponse } from "../../domain/vehicle";
import { StatusPill } from "../../shared/ui";

interface VehicleDetailViewProps {
  vehicle: VehicleResponse;
}

function renderNullable(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <dt className="text-sm text-content-subtle">{label}</dt>
      <dd className="text-sm text-content text-right break-all">{value}</dd>
    </div>
  );
}

export function VehicleDetailView({ vehicle }: VehicleDetailViewProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Vehicle</h3>
        <StatusPill status={vehicle.active ? "ACTIVE" : "SUSPENDED"} />
      </div>
      <dl className="mt-3">
        <Row label="ID" value={vehicle.id} />
        <Row label="Driver ID" value={vehicle.driverId} />
        <Row label="Plate number" value={vehicle.plateNumber} />
        <Row label="Type" value={vehicle.vehicleType} />
        <Row label="Brand" value={renderNullable(vehicle.brand)} />
        <Row label="Model" value={renderNullable(vehicle.model)} />
        <Row label="Color" value={renderNullable(vehicle.color)} />
        <Row label="Active" value={vehicle.active ? "Yes" : "No"} />
        <Row label="Created at" value={vehicle.createdAt} />
        <Row label="Updated at" value={vehicle.updatedAt} />
      </dl>
    </div>
  );
}
