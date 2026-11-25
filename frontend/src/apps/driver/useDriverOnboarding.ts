/**
 * useDriverOnboarding — resumable two-step onboarding (Req 9.3, 9.4).
 *
 * Step 1 creates the driver profile, step 2 adds the vehicle. A step that already
 * succeeded is never repeated on retry, so a failed vehicle call does not create a
 * second driver (which the backend would reject as a duplicate user).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverResponse, DriverServiceClient } from "../../domain/driver/contract";
import type { CreateVehicleRequest } from "../../domain/vehicle/contract";
import { safeMessage } from "../../shared/errors";

export interface OnboardingForm {
  licenseNumber: string;
  vehicle: CreateVehicleRequest;
}

export interface DriverOnboarding {
  /** Runs the steps that have not succeeded yet. Resolves to the driver, or null on failure. */
  submit: (form: OnboardingForm) => Promise<DriverResponse | null>;
  pending: boolean;
  /** Backend message of the last failed step, or null. */
  error: string | null;
}

const messageOf = safeMessage;

export function useDriverOnboarding(
  userId: string,
  client?: Pick<DriverServiceClient, "createDriver" | "addVehicle">,
): DriverOnboarding {
  const resolved = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const driverRef = useRef<DriverResponse | null>(null);
  const vehicleDone = useRef(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (form: OnboardingForm): Promise<DriverResponse | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        if (driverRef.current === null) {
          driverRef.current = await resolved.createDriver({
            userId,
            licenseNumber: form.licenseNumber,
          });
        }
        if (!vehicleDone.current) {
          await resolved.addVehicle(driverRef.current.id, form.vehicle);
          vehicleDone.current = true;
        }
        return driverRef.current;
      } catch (e) {
        setError(messageOf(e));
        return null;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [resolved, userId],
  );

  return { submit, pending, error };
}
