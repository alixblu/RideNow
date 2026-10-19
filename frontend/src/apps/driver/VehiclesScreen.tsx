/**
 * VehiclesScreen — add a vehicle to a driver, list a driver's vehicles, and open a
 * vehicle by id (Req 6.1–6.5).
 *
 * A driver-id input scopes the add-vehicle form and the vehicle list. The add form
 * collects a plate number, a Vehicle_Type (selector restricted to VEHICLE_TYPE_VALUES,
 * Req 6.3), and optional brand/model/color; client-side validation blocks submission
 * when the plate number or vehicle type is missing (Req 6.2) and no request is issued.
 * The list renders each vehicle's plate number, type, brand, model, color, and active
 * state (Req 6.4). A separate vehicle-id lookup opens full detail (Req 6.5).
 *
 * Vehicle operations go through the driver Service_Client (which owns add/list/get
 * vehicle on driver-service), so screens depend only on the contract (Req 4.3).
 * Restyled on the Tailwind kit; field labels, ids, and `role="alert"` messages preserved.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverServiceClient } from "../../domain/driver";
import type { CreateVehicleRequest } from "../../domain/vehicle";
import type { VehicleType } from "../../shared/enums";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";
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
  useToast,
} from "../../shared/ui";
import { VehicleDetailView } from "./VehicleDetailView";

interface VehiclesScreenProps {
  client: DriverServiceClient;
}

interface AddFieldErrors {
  plateNumber?: string;
  vehicleType?: string;
}

function renderCell(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

/**
 * Build a `CreateVehicleRequest`, including the optional free-text fields only when
 * non-empty. `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional
 * property, so omitting the key is the correct way to leave a field unset.
 */
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

export function VehiclesScreen({ client }: VehiclesScreenProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [driverIdInput, setDriverIdInput] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);

  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType | "">("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [addErrors, setAddErrors] = useState<AddFieldErrors>({});

  const [vehicleIdInput, setVehicleIdInput] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["vehicles", driverId],
    queryFn: () => client.listVehicles(driverId as string),
    enabled: driverId !== null,
  });

  const addMutation = useMutation({
    mutationFn: (vars: { driverId: string; request: CreateVehicleRequest }) =>
      client.addVehicle(vars.driverId, vars.request),
    onSuccess: () => {
      if (driverId !== null) {
        queryClient.invalidateQueries({ queryKey: ["vehicles", driverId] });
      }
      setPlateNumber("");
      setVehicleType("");
      setBrand("");
      setModel("");
      setColor("");
      toast("Vehicle added.", "success");
    },
  });

  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => client.getVehicle(vehicleId as string),
    enabled: vehicleId !== null,
  });

  function handleSetDriver(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = driverIdInput.trim();
    if (trimmed === "") return;
    setDriverId(trimmed);
  }

  function handleAddVehicle(event: React.FormEvent) {
    event.preventDefault();
    const errors: AddFieldErrors = {};
    if (plateNumber.trim() === "") errors.plateNumber = "Plate number is required.";
    if (vehicleType === "") errors.vehicleType = "Vehicle type is required.";
    setAddErrors(errors);
    if (Object.keys(errors).length > 0 || driverId === null || vehicleType === "") {
      return; // Block submission; no request issued (Req 6.2).
    }
    addMutation.mutate({
      driverId,
      request: buildVehicleRequest(plateNumber, vehicleType, brand, model, color),
    });
  }

  function handleVehicleLookup(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = vehicleIdInput.trim();
    if (trimmed === "") return;
    setVehicleId(trimmed);
  }

  const addError = addMutation.error;
  const addUnavailable = addError instanceof ApiError && addError.code === "UNAVAILABLE";
  const listError = listQuery.error;
  const listUnavailable = listError instanceof ApiError && listError.code === "UNAVAILABLE";
  const vehicleError = vehicleQuery.error;
  const vehicleNotFound = vehicleError instanceof ApiError && vehicleError.code === "NOT_FOUND";
  const vehicleUnavailable = vehicleError instanceof ApiError && vehicleError.code === "UNAVAILABLE";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="flex items-end gap-2" onSubmit={handleSetDriver} noValidate>
            <Field htmlFor="vehicles-driver-id" label="Driver ID" className="flex-1">
              <Input
                id="vehicles-driver-id"
                value={driverIdInput}
                onChange={(e) => setDriverIdInput(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              Use driver
            </Button>
          </form>

          {driverId === null ? (
            <p className="mt-4 text-sm text-content-subtle">
              Enter a driver ID to add and list that driver&apos;s vehicles.
            </p>
          ) : (
            <>
              <form className="mt-5 flex flex-col gap-4" onSubmit={handleAddVehicle} noValidate>
                <h4 className="text-sm font-semibold text-content">Add vehicle</h4>

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
                      if (driverId !== null && vehicleType !== "") {
                        addMutation.mutate({
                          driverId,
                          request: buildVehicleRequest(plateNumber, vehicleType, brand, model, color),
                        });
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

              <h4 className="mt-6 text-sm font-semibold text-content">Vehicle list</h4>
              <div className="mt-2">
                {listQuery.isPending && <Loading label="Loading vehicles…" />}
                {listUnavailable && <Unavailable onRetry={() => listQuery.refetch()} />}
                {listError && !listUnavailable && (
                  <ErrorBanner
                    message={listError instanceof ApiError ? listError.message : "Could not load vehicles."}
                  />
                )}
                {listQuery.data &&
                  (listQuery.data.length === 0 ? (
                    <EmptyState message="No vehicles on file for this driver." />
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface-raised text-left text-content-muted">
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
                  ))}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicle lookup</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="flex items-end gap-2" onSubmit={handleVehicleLookup} noValidate>
            <Field htmlFor="lookup-vehicle-id" label="Vehicle ID" className="flex-1">
              <Input
                id="lookup-vehicle-id"
                value={vehicleIdInput}
                onChange={(e) => setVehicleIdInput(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              Open
            </Button>
          </form>

          <div className="mt-4">
            {vehicleQuery.isPending && vehicleId !== null && <Loading label="Loading vehicle…" />}
            {vehicleNotFound && <ErrorBanner message={`No vehicle found for id "${vehicleId}".`} />}
            {vehicleUnavailable && <Unavailable onRetry={() => vehicleQuery.refetch()} />}
            {vehicleError && !vehicleNotFound && !vehicleUnavailable && (
              <ErrorBanner
                message={vehicleError instanceof ApiError ? vehicleError.message : "Could not load the vehicle."}
              />
            )}
            {vehicleQuery.data && <VehicleDetailView vehicle={vehicleQuery.data} />}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
