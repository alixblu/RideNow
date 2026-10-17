/**
 * DriverLookupScreen — open a driver profile by id (Req 5.3) and change its status
 * (Req 7.2, 7.3).
 *
 * A lookup form sets the active driver id; a TanStack `useQuery` then fetches the driver
 * and renders ALL `DriverResponse` fields through the shared `DriverDetailView`. A 404
 * surfaces as a not-found message (Req 5.4, 7.3); an unreachable service shows a retry
 * (Req 13.3); loading shows the shared indicator (Req 13.1). Restyled on the Tailwind kit.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverServiceClient } from "../../domain/driver";
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
  Loading,
  Unavailable,
  useToast,
} from "../../shared/ui";
import { DriverDetailView } from "./DriverDetailView";

interface DriverLookupScreenProps {
  client: DriverServiceClient;
}

export function DriverLookupScreen({ client }: DriverLookupScreenProps) {
  const [idInput, setIdInput] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => client.getDriver(driverId as string),
    enabled: driverId !== null,
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { driverId: string; status: DriverStatus }) =>
      client.changeStatus(vars.driverId, vars.status),
    onSuccess: (driver) => {
      queryClient.setQueryData(["driver", driver.id], driver);
      toast(`Status changed to ${driver.status}.`, "success");
    },
  });

  function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = idInput.trim();
    if (trimmed === "") {
      return;
    }
    setDriverId(trimmed);
  }

  const error = driverQuery.error;
  const isNotFound = error instanceof ApiError && error.code === "NOT_FOUND";
  const isUnavailable = error instanceof ApiError && error.code === "UNAVAILABLE";

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Driver lookup</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex items-end gap-2" onSubmit={handleLookup} noValidate>
          <Field htmlFor="lookup-driver-id" label="Driver ID" className="flex-1">
            <Input
              id="lookup-driver-id"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </form>

        <div className="mt-4">
          {driverQuery.isPending && driverId !== null && <Loading label="Loading driver…" />}

          {isNotFound && (
            <ErrorBanner message={`No driver found for id "${driverId}".`} />
          )}
          {isUnavailable && <Unavailable onRetry={() => driverQuery.refetch()} />}
          {error && !isNotFound && !isUnavailable && (
            <ErrorBanner
              message={
                error instanceof ApiError ? error.message : "Could not load the driver."
              }
            />
          )}

          {driverQuery.data && (
            <DriverDetailView
              driver={driverQuery.data}
              changing={statusMutation.isPending}
              onChangeStatus={(status) =>
                statusMutation.mutate({ driverId: driverQuery.data.id, status })
              }
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}
