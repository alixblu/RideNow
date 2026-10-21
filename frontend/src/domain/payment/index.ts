/**
 * Payment domain entry — resolves the payment `Service_Client` from configuration and
 * re-exports the public contract so screens import a single stable module (Req 4.2,
 * 11.4).
 *
 * `resolvePaymentClient` delegates to the generic `resolveClient` factory, passing the
 * per-domain mode (`config.clients.payment.mode`) and lazy thunks for the live and mock
 * implementations. Only the selected implementation is constructed, so switching the
 * payment domain between live and mock is purely a configuration change — no screen
 * touches this decision.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { PaymentServiceClient } from "./contract";
import { createPaymentLiveClient } from "./liveClient";
import { createPaymentMockClient } from "./mockClient";

export type {
  CreatePaymentRequest,
  PaymentMethod,
  PaymentResponse,
  PaymentServiceClient,
} from "./contract";

/**
 * Resolve the payment `Service_Client` for the given config.
 *
 * @param config the resolved app configuration
 * @returns a `PaymentServiceClient` — live or mock per `config.clients.payment.mode`
 */
export function resolvePaymentClient(config: AppConfig): PaymentServiceClient {
  return resolveClient(
    config.clients.payment.mode,
    createPaymentLiveClient,
    createPaymentMockClient,
  );
}
