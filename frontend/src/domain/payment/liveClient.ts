/**
 * Payment Live_Client — the real-HTTP implementation of `PaymentServiceClient`.
 *
 * Every operation maps one-to-one to a payment-service endpoint and goes through
 * `httpRequest`, so URL resolution (gateway vs Path_Prefix_Map), principal attachment,
 * and error normalization stay centralized in the http layer. This client only knows
 * paths, methods, and bodies.
 *
 * Paths use the documented `/api/payments` prefix that the Path_Prefix_Map routes to
 * payment-service. Caller-supplied identifiers and query values are URL-encoded.
 */
import { httpRequest } from "../../http/httpClient";
import type {
  CreatePaymentRequest,
  PaymentResponse,
  PaymentServiceClient,
} from "./contract";

const PAYMENTS_PATH = "/api/payments";

/**
 * Build the payment-service `Live_Client`.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern.
 */
export function createPaymentLiveClient(): PaymentServiceClient {
  return {
    getPayment(id: string): Promise<PaymentResponse> {
      return httpRequest<PaymentResponse>(
        `${PAYMENTS_PATH}/${encodeURIComponent(id)}`,
      );
    },

    getPaymentForTrip(tripId: string): Promise<PaymentResponse> {
      return httpRequest<PaymentResponse>(
        `${PAYMENTS_PATH}?tripId=${encodeURIComponent(tripId)}`,
      );
    },

    createPayment(req: CreatePaymentRequest): Promise<PaymentResponse> {
      return httpRequest<PaymentResponse>(PAYMENTS_PATH, {
        method: "POST",
        body: req,
      });
    },
  };
}
