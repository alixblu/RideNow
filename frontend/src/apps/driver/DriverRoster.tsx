/**
 * DriverRoster — the PRIMARY driver surface: a roster-first experience.
 *
 * Instead of typing a driver id, a driver browses the live roster (listDrivers),
 * opens one by selecting a row, and works that driver: full profile, their vehicles
 * (with an add-vehicle form), and a status toggle. Alongside sits an "Available rides"
 * panel listing SEARCHING trips the opened driver can accept through the real
 * optimistic-lock accept endpoint.
 *
 * Selection-driven: opening a driver sets `openedDriverId`; nothing here asks the user
 * to type an id on the primary path. All data comes from the real driver + trip
 * Service_Clients. Accept handles the lost-race CONFLICT (409 "already taken") by
 * toasting and refetching so the taken ride drops out of the list.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Users } from "lucide-react";
import type { DriverServiceClient } from "../../domain/driver";
import type { CreateVehicleRequest } from "../../domain/vehicle";
import type { TripServiceClient, TripResponse } from "../../domain/trip";
import type { DriverStatus, VehicleType } from "../../shared/enums";
import { DRIVER_STATUS_VALUES, VEHICLE_TYPE_VALUES } from "../../shared/enums";
import { ApiError } from "../../http/ApiError";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Loading,
  Select,
  StatusPill,
  Unavailable,
  cn,
  useToast,
} from "../../shared/ui";
import { DriverDetailView } from "./DriverDetailView";

interface DriverRosterProps {
  client: DriverServiceClient;
  tripClient: TripServiceClient;
}

type StatusFilter = DriverStatus | "ALL";

const STATUS_FILTERS: StatusFilter[] = ["ALL", ...DRIVER_STATUS_VALUES];

function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "UNAVAILABLE";
}

export function DriverRoster({ client, tripClient }: DriverRosterProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [openedDriverId, setOpenedDriverId] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["drivers", statusFilter],
    queryFn: () =>
      client.listDrivers(
        statusFilter === "ALL" ? {} : { status: statusFilter },
      ),
  });

  const drivers = rosterQuery.data?.items ?? [];
  const rosterUnavailable = isUnavailable(rosterQuery.error);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="flex flex-col gap-5 lg:col-span-3">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Roster</CardTitle>
            <div className="w-40">
              <Select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value === "ALL" ? "All statuses" : value}
                  </option>
                ))}
              </Select>
            </div>
          </CardHeader>
          <CardBody>
            {rosterQuery.isPending ? (
              <Loading label="Loading drivers…" />
            ) : rosterUnavailable ? (
              <Unavailable onRetry={() => rosterQuery.refetch()} />
            ) : rosterQuery.isError ? (
              <ErrorBanner
                message={
                  rosterQuery.error instanceof ApiError
                    ? rosterQuery.error.message
                    : "Could not load drivers."
                }
              />
            ) : drivers.length === 0 ? (
              <EmptyState message="No drivers match this filter." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-raised text-left text-content-muted">
                      <th className="px-3 py-2 font-medium">License number</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Rating</th>
                      <th className="px-3 py-2 font-medium">Trips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((driver) => {
                      const selected = driver.id === openedDriverId;
                      return (
                        <tr
                          key={driver.id}
                          role="button"
                          tabIndex={0}
                          aria-current={selected ? "true" : undefined}
                          aria-label={`Open driver ${driver.licenseNumber}`}
                          onClick={() => setOpenedDriverId(driver.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setOpenedDriverId(driver.id);
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-b border-border/60 transition-colors last:border-0",
                            selected ? "bg-surface-raised" : "hover:bg-surface-raised",
                          )}
                        >
                          <td className="px-3 py-2 font-medium text-content">
                            {driver.licenseNumber}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill status={driver.status} />
                          </td>
                          <td className="px-3 py-2">
                            {driver.averageRating === null
                              ? "—"
                              : driver.averageRating}
                          </td>
                          <td className="px-3 py-2">{driver.totalTrips}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {openedDriverId !== null && (
          <OpenedDriver
            key={openedDriverId}
            client={client}
            driverId={openedDriverId}
            onClose={() => setOpenedDriverId(null)}
          />
        )}
      </div>

      <div className="lg:col-span-2">
        <AvailableRides
          tripClient={tripClient}
          openedDriverId={openedDriverId}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opened driver — profile, vehicles + add form, and the status toggle.
// ---------------------------------------------------------------------------

interface OpenedDriverProps {
  client: DriverServiceClient;
  driverId: string;
  onClose: () => void;
}

function OpenedDriver({ client, driverId, onClose }: OpenedDriverProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => client.getDriver(driverId),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { status: DriverStatus }) =>
      client.changeStatus(driverId, vars.status),
    onSuccess: (driver) => {
      queryClient.setQueryData(["driver", driverId], driver);
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast(`Status changed to ${driver.status}.`, "success");
    },
  });

  const error = driverQuery.error;
  const notFound = error instanceof ApiError && error.code === "NOT_FOUND";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Opened driver</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardBody>
        {driverQuery.isPending ? (
          <Loading label="Loading driver…" />
        ) : isUnavailable(error) ? (
          <Unavailable onRetry={() => driverQuery.refetch()} />
        ) : notFound ? (
          <ErrorBanner message={`No driver found for id "${driverId}".`} />
        ) : driverQuery.isError ? (
          <ErrorBanner
            message={
              error instanceof ApiError ? error.message : "Could not load the driver."
            }
          />
        ) : driverQuery.data ? (
          <div className="flex flex-col gap-5">
            <DriverDetailView
              driver={driverQuery.data}
              changing={statusMutation.isPending}
              onChangeStatus={(status) => statusMutation.mutate({ status })}
            />
            <DriverVehicles client={client} driverId={driverId} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Vehicles for the opened driver — list + add form (labels preserved).
// ---------------------------------------------------------------------------

interface AddFieldErrors {
  plateNumber?: string;
  vehicleType?: string;
}

function renderCell(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function buildVehicleRequest(
  plateNumber: string,
  vehicleType: VehicleType,
  brand: string,
  model: string,
  color: string,
): CreateVehicleRequest {
  const req: CreateVehicleRequest = {
    plateNumber: plateNumber.trim(),
    vehicleType,
  };
  if (brand.trim() !== "") req.brand = brand.trim();
  if (model.trim() !== "") req.model = model.trim();
  if (color.trim() !== "") req.color = color.trim();
  return req;
}

function DriverVehicles({
  client,
  driverId,
}: {
  client: DriverServiceClient;
  driverId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType | "">("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [addErrors, setAddErrors] = useState<AddFieldErrors>({});

  const listQuery = useQuery({
    queryKey: ["vehicles", driverId],
    queryFn: () => client.listVehicles(driverId),
  });

  const addMutation = useMutation({
    mutationFn: (request: CreateVehicleRequest) =>
      client.addVehicle(driverId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles", driverId] });
      setPlateNumber("");
      setVehicleType("");
      setBrand("");
      setModel("");
      setColor("");
      setAddErrors({});
      toast("Vehicle added.", "success");
    },
  });

  function handleAddVehicle(event: FormEvent) {
    event.preventDefault();
    const errors: AddFieldErrors = {};
    if (plateNumber.trim() === "") errors.plateNumber = "Plate number is required.";
    if (vehicleType === "") errors.vehicleType = "Vehicle type is required.";
    setAddErrors(errors);
    if (Object.keys(errors).length > 0 || vehicleType === "") {
      return; // Block submission; no request issued.
    }
    addMutation.mutate(
      buildVehicleRequest(plateNumber, vehicleType, brand, model, color),
    );
  }

  const addError = addMutation.error;
  const addUnavailable = isUnavailable(addError);
  const listUnavailable = isUnavailable(listQuery.error);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <h4 className="text-sm font-semibold text-content">Add vehicle</h4>
      <form className="mt-3 flex flex-col gap-4" onSubmit={handleAddVehicle} noValidate>
        <Field htmlFor="add-vehicle-plate" label="Plate number" error={addErrors.plateNumber}>
          <Input
            id="add-vehicle-plate"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            invalid={Boolean(addErrors.plateNumber)}
          />
        </Field>

        <Field htmlFor="add-vehicle-type" label="Vehicle type" error={addErrors.vehicleType}>
          <Select
            id="add-vehicle-type"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value as VehicleType | "")}
            invalid={Boolean(addErrors.vehicleType)}
          >
            <option value="">Select a type…</option>
            {VEHICLE_TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field htmlFor="add-vehicle-brand" label="Brand">
            <Input id="add-vehicle-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field htmlFor="add-vehicle-model" label="Model">
            <Input id="add-vehicle-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field htmlFor="add-vehicle-color" label="Color">
            <Input id="add-vehicle-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
        </div>

        <Button type="submit" loading={addMutation.isPending}>
          {addMutation.isPending ? "Adding…" : "Add vehicle"}
        </Button>
      </form>

      {addUnavailable && (
        <div className="mt-3">
          <Unavailable
            onRetry={() => {
              if (vehicleType !== "") {
                addMutation.mutate(
                  buildVehicleRequest(plateNumber, vehicleType, brand, model, color),
                );
              }
            }}
          />
        </div>
      )}
      {addError && !addUnavailable && (
        <div className="mt-3">
          <ErrorBanner
            message={addError instanceof ApiError ? addError.message : "Could not add the vehicle."}
          />
        </div>
      )}

      <h4 className="mt-6 text-sm font-semibold text-content">Vehicles</h4>
      <div className="mt-2">
        {listQuery.isPending ? (
          <Loading label="Loading vehicles…" />
        ) : listUnavailable ? (
          <Unavailable onRetry={() => listQuery.refetch()} />
        ) : listQuery.isError ? (
          <ErrorBanner
            message={listQuery.error instanceof ApiError ? listQuery.error.message : "Could not load vehicles."}
          />
        ) : listQuery.data && listQuery.data.length === 0 ? (
          <EmptyState message="No vehicles on file for this driver." />
        ) : listQuery.data ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-content-muted">
                  <th className="px-3 py-2 font-medium">Plate number</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Color</th>
                  <th className="px-3 py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{vehicle.plateNumber}</td>
                    <td className="px-3 py-2">{vehicle.vehicleType}</td>
                    <td className="px-3 py-2">{renderCell(vehicle.brand)}</td>
                    <td className="px-3 py-2">{renderCell(vehicle.model)}</td>
                    <td className="px-3 py-2">{renderCell(vehicle.color)}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={vehicle.active ? "ACTIVE" : "SUSPENDED"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Available rides — SEARCHING trips the opened driver can accept.
// ---------------------------------------------------------------------------

interface AvailableRidesProps {
  tripClient: TripServiceClient;
  openedDriverId: string | null;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function AvailableRides({ tripClient, openedDriverId }: AvailableRidesProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const ridesQuery = useQuery({
    queryKey: ["searching-trips"],
    queryFn: () => tripClient.listTrips({ status: "SEARCHING" }),
  });

  const acceptMutation = useMutation({
    mutationFn: (vars: { tripId: string; driverId: string }) =>
      tripClient.acceptTrip(vars.tripId, vars.driverId),
    onSettled: () => setAcceptingId(null),
    onSuccess: () => {
      toast("Ride accepted.", "success");
      void queryClient.invalidateQueries({ queryKey: ["searching-trips"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        toast("This ride was just taken.", "info");
        void queryClient.invalidateQueries({ queryKey: ["searching-trips"] });
        return;
      }
      toast(
        error instanceof ApiError ? error.message : "Could not accept the ride.",
        "error",
      );
    },
  });

  function handleAccept(trip: TripResponse) {
    if (openedDriverId === null) {
      return;
    }
    setAcceptingId(trip.id);
    acceptMutation.mutate({ tripId: trip.id, driverId: openedDriverId });
  }

  const rides = ridesQuery.data?.items ?? [];
  const ridesUnavailable = isUnavailable(ridesQuery.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Available rides</CardTitle>
      </CardHeader>
      <CardBody>
        {openedDriverId === null && (
          <div
            role="status"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-3 text-sm text-content-muted"
          >
            <Users className="h-4 w-4 text-content-subtle" aria-hidden="true" />
            Open a driver from the roster to accept rides.
          </div>
        )}

        {ridesQuery.isPending ? (
          <Loading label="Loading available rides…" />
        ) : ridesUnavailable ? (
          <Unavailable onRetry={() => ridesQuery.refetch()} />
        ) : ridesQuery.isError ? (
          <ErrorBanner
            message={
              ridesQuery.error instanceof ApiError
                ? ridesQuery.error.message
                : "Could not load available rides."
            }
          />
        ) : rides.length === 0 ? (
          <EmptyState message="No rides are waiting for a driver right now." />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Available rides">
            {rides.map((trip) => (
              <li
                key={trip.id}
                className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-content">
                    <Car className="h-4 w-4 text-accent" aria-hidden="true" />
                    {trip.rideType === "MOTORBIKE" ? "Motorbike" : "Car"}
                  </span>
                  <time
                    dateTime={trip.requestedAt}
                    className="text-xs text-content-subtle"
                  >
                    {formatTimestamp(trip.requestedAt)}
                  </time>
                </div>
                <p className="break-all text-xs text-content-muted">
                  {`${trip.pickupLat}, ${trip.pickupLng}`} →{" "}
                  {`${trip.destinationLat}, ${trip.destinationLng}`}
                </p>
                <Button
                  size="sm"
                  disabled={openedDriverId === null}
                  loading={acceptingId === trip.id}
                  onClick={() => handleAccept(trip)}
                >
                  {acceptingId === trip.id ? "Accepting…" : "Accept"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
