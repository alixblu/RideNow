/**
 * Payment domain entry — resolves the payment `Service_Client` from configuration and
 * re-exports the public contract so screens import a single stable module (Req 4.2,
 * 11.4).
 *
 * The payment domain is STUBBED: no payment-service exists, so the live thunk cannot
 * build a real client. It throws a clear "not implemented" error, which the generic
 * `resolveClient` only ever invokes if the payment domain were explicitly configured
 * `live` — the default is `mock`, so the mock thunk runs and returns the in-memory
 * client. When a payment-service lands, this live thunk is the one place that becomes a
 * `createPaymentLiveClient()` call; no screen changes.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { PaymentServiceClient } from "./contract";
import { createPaymentMockClient } from "./mockClient";

export type {
  PaymentMethod,
  PaymentResponse,
  PaymentServiceClient,
} from "./contract";

/**
 * Resolve the payment `Service_Client` for the given config.
 *
 * @param config the resolved app configuration
 * @returns the payment Mock_Client (default), or throws if forced to `live` while the
 *          payment-service does not yet exist.
 */
export function resolvePaymentClient(config: AppConfig): PaymentServiceClient {
  return resolveClient(
    config.clients.payment.mode,
    () => {
      throw new Error("payment live client not implemented");
    },
    () => createPaymentMockClient(),
  );
}
