/**
 * DriverContext — carries the signed-in Account's driver profile (Req 9.5).
 *
 * The Account id and the Driver id are different UUIDs, so screens read the driver id
 * from here instead of assuming `identity.id === driverId`.
 */
import { createContext, useContext } from "react";
import type { DriverResponse } from "../../domain/driver/contract";

export const DriverContext = createContext<DriverResponse | null>(null);

/** The current driver profile. Throws outside a `DriverContext.Provider`. */
export function useDriver(): DriverResponse {
  const driver = useContext(DriverContext);
  if (driver === null) {
    throw new Error("useDriver must be used within a DriverContext provider (DriverApp).");
  }
  return driver;
}
