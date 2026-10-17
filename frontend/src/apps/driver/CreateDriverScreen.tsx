/**
 * CreateDriverScreen — the create-driver form (Req 5.1, 5.2).
 *
 * Collects `userId` and `licenseNumber`. Client-side required-field validation blocks
 * submission and shows a field-level message when either is blank, and no request is
 * issued until both are present (Req 5.2). On success the created driver is shown via
 * the shared `DriverDetailView`, which also exposes the status-change control (Req 5.1,
 * 7.2). Restyled on the Tailwind kit; field labels and `role="alert"` messages preserved.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DriverServiceClient, DriverResponse } from "../../domain/driver";
import type { DriverStatus } from "../../shared/enums";
import { ApiError } from "../../http/ApiError";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ErrorBanner,
  Field,
  Input,
  Unavailable,
  useToast,
} from "../../shared/ui";
import { DriverDetailView } from "./DriverDetailView";

interface CreateDriverScreenProps {
  client: DriverServiceClient;
}

interface FieldErrors {
  userId?: string;
  licenseNumber?: string;
}

function validate(userId: string, licenseNumber: string): FieldErrors {
  const errors: FieldErrors = {};
  if (userId.trim() === "") {
    errors.userId = "User ID is required.";
  }
  if (licenseNumber.trim() === "") {
    errors.licenseNumber = "License number is required.";
  }
  return errors;
}

export function CreateDriverScreen({ client }: CreateDriverScreenProps) {
  const [userId, setUserId] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<DriverResponse | null>(null);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (vars: { userId: string; licenseNumber: string }) =>
      client.createDriver({
        userId: vars.userId.trim(),
        licenseNumber: vars.licenseNumber.trim(),
      }),
    onSuccess: (driver) => {
      setCreated(driver);
      toast("Driver created.", "success");
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { driverId: string; status: DriverStatus }) =>
      client.changeStatus(vars.driverId, vars.status),
    onSuccess: (driver) => {
      setCreated(driver);
      toast(`Status changed to ${driver.status}.`, "success");
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(userId, licenseNumber);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return; // Block submission; no request issued (Req 5.2).
    }
    createMutation.mutate({ userId, licenseNumber });
  }

  const createError = createMutation.error;
  const unavailable =
    createError instanceof ApiError && createError.code === "UNAVAILABLE";

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Create driver</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate aria-label="Create driver">
          <Field htmlFor="create-driver-userId" label="User ID" required error={errors.userId}>
            <Input
              id="create-driver-userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              invalid={Boolean(errors.userId)}
            />
          </Field>

          <Field
            htmlFor="create-driver-license"
            label="License number"
            required
            error={errors.licenseNumber}
          >
            <Input
              id="create-driver-license"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              invalid={Boolean(errors.licenseNumber)}
            />
          </Field>

          <Button type="submit" size="lg" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create driver"}
          </Button>
        </form>

        {unavailable && (
          <div className="mt-4">
            <Unavailable onRetry={() => createMutation.mutate({ userId, licenseNumber })} />
          </div>
        )}
        {createError && !unavailable && (
          <div className="mt-4">
            <ErrorBanner
              message={
                createError instanceof ApiError
                  ? createError.message
                  : "Could not create the driver."
              }
            />
          </div>
        )}

        {created && (
          <div className="mt-5">
            <DriverDetailView
              driver={created}
              changing={statusMutation.isPending}
              onChangeStatus={(status) =>
                statusMutation.mutate({ driverId: created.id, status })
              }
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
