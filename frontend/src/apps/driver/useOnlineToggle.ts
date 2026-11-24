/**
 * useOnlineToggle — optimistic online/offline toggle for the Driver_App (Req 5.3, 5.4).
 *
 * `toggle()` flips `online` immediately, then calls `goOnline`/`goOffline`. If the call
 * rejects, the previous value is restored and an error toast shows `friendlyError`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { appConfig } from "../../config/appConfig";
import { resolveDriverClient } from "../../domain/driver";
import type { DriverServiceClient } from "../../domain/driver/contract";
import { friendlyError } from "../../shared/errors";
import { useToast } from "../../shared/ui";

export interface OnlineToggle {
  online: boolean;
  pending: boolean;
  /** Flip to the opposite state. Resolves to the final `online` value. */
  toggle: () => Promise<boolean>;
}

export function useOnlineToggle(
  driverId: string,
  client?: Pick<DriverServiceClient, "goOnline" | "goOffline">,
  initialOnline = false,
): OnlineToggle {
  const { toast } = useToast();
  const resolved = useMemo(() => client ?? resolveDriverClient(appConfig), [client]);
  const [online, setOnline] = useState(initialOnline);
  const [pending, setPending] = useState(false);
  // Ref mirrors state so rapid calls see the latest value and in-flight calls are ignored.
  const onlineRef = useRef(initialOnline);
  const pendingRef = useRef(false);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (pendingRef.current) return onlineRef.current;
    const previous = onlineRef.current;
    const target = !previous;
    pendingRef.current = true;
    onlineRef.current = target;
    setPending(true);
    setOnline(target);
    try {
      if (target) {
        await resolved.goOnline(driverId);
      } else {
        await resolved.goOffline(driverId);
      }
    } catch (error) {
      onlineRef.current = previous;
      setOnline(previous);
      toast(friendlyError(error), "error");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    return onlineRef.current;
  }, [driverId, resolved, toast]);

  return { online, pending, toggle };
}
