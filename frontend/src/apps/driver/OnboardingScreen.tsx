/**
 * OnboardingScreen — the driver profile and vehicle form (Req 9.2, 9.3, 9.4).
 *
 * Shown when a DRIVER Account has no driver profile yet. Entered values are kept when
 * a step fails, and a retry skips the steps that already succeeded.
 */
import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { DriverResponse, DriverServiceClient } from "../../domain/driver/contract";
import type { VehicleType } from "../../shared/enums";
import { Button, Field, Input, Select } from "../../shared/ui";
import { useDriverOnboarding } from "./useDriverOnboarding";

interface OnboardingScreenProps {
  userId: string;
  client?: Pick<DriverServiceClient, "createDriver" | "addVehicle"> | undefined;
  onComplete: (driver: DriverResponse) => void;
}

export function OnboardingScreen({ userId, client, onComplete }: OnboardingScreenProps) {
  const ids = useId();
  const onboarding = useDriverOnboarding(userId, client);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("MOTORBIKE");
  const [plateNumber, setPlateNumber] = useState("");
  const [model, setModel] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const licenseError = submitted && licenseNumber.trim() === "" ? "Enter your license number." : undefined;
  const plateError = submitted && plateNumber.trim() === "" ? "Enter the plate number." : undefined;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (licenseNumber.trim() === "" || plateNumber.trim() === "") return;
    const driver = await onboarding.submit({
      licenseNumber: licenseNumber.trim(),
      vehicle: {
        plateNumber: plateNumber.trim(),
        vehicleType,
        ...(model.trim() !== "" ? { model: model.trim() } : {}),
      },
    });
    if (driver) onComplete(driver);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void handleSubmit(e)}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div>
        <h1 className="text-2xl font-bold">Set up your driver profile</h1>
        <p className="text-sm text-content-muted">Add your license and vehicle to start driving.</p>
      </div>
      <Field htmlFor={`${ids}-license`} label="License number" required {...(licenseError ? { error: licenseError } : {})}>
        <Input
          id={`${ids}-license`}
          value={licenseNumber}
          invalid={licenseError !== undefined}
          autoComplete="off"
          onChange={(e) => setLicenseNumber(e.target.value)}
        />
      </Field>
      <Field htmlFor={`${ids}-type`} label="Vehicle type" required>
        <Select
          id={`${ids}-type`}
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
        >
          <option value="MOTORBIKE">Motorbike</option>
          <option value="CAR">Car</option>
        </Select>
      </Field>
      <Field htmlFor={`${ids}-plate`} label="Plate number" required {...(plateError ? { error: plateError } : {})}>
        <Input
          id={`${ids}-plate`}
          value={plateNumber}
          invalid={plateError !== undefined}
          autoComplete="off"
          onChange={(e) => setPlateNumber(e.target.value)}
        />
      </Field>
      <Field htmlFor={`${ids}-model`} label="Vehicle model">
        <Input
          id={`${ids}-model`}
          value={model}
          autoComplete="off"
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>
      {onboarding.error ? (
        <p role="alert" className="text-sm text-danger">
          {onboarding.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" block loading={onboarding.pending}>
        Continue
      </Button>
    </form>
  );
}
