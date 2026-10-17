/**
 * PaymentScreen — rider payment view (Req 11.1–11.3).
 *
 * Fetches the payment for a trip from the payment client and renders its amount,
 * currency, method, and status (Req 11.1). The status is one of the defined
 * Payment_Status values (Req 11.2), shown as a pill. When the status is FAILED the
 * payment carries a non-empty failure reason, which this screen surfaces (Req 11.3).
 *
 * A trip id is required; it defaults to the active trip shared with the trip screen and
 * can be overridden with a direct lookup. Restyled as an Uber-style fare card.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { resolvePaymentClient } from "../../domain/payment";
import type { PaymentResponse } from "../../domain/payment";
import { appConfig } from "../../config/appConfig";
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
  StatusPill,
} from "../../shared/ui";
import { errorView } from "./shared";

const paymentClient = resolvePaymentClient(appConfig);

interface PaymentScreenProps {
  activeTripId: string | null;
}

export function PaymentScreen({ activeTripId }: PaymentScreenProps) {
  const [tripId, setTripId] = useState(activeTripId ?? "");
  const [submittedId, setSubmittedId] = useState<string | null>(activeTripId);

  const paymentQuery = useQuery<PaymentResponse, Error>({
    queryKey: ["payment", submittedId],
    queryFn: () => paymentClient.getPaymentForTrip(submittedId as string),
    enabled: submittedId !== null && submittedId.length > 0,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = tripId.trim();
    setSubmittedId(trimmed.length > 0 ? trimmed : null);
  }

  const payment = paymentQuery.data ?? null;

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Payment</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="flex items-end gap-2" onSubmit={handleSubmit} aria-label="Look up payment">
          <Field htmlFor="payment-trip-id" label="Trip ID" className="flex-1">
            <Input
              id="payment-trip-id"
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              placeholder="Trip ID to look up payment"
            />
          </Field>
          <Button type="submit" variant="secondary">
            View
          </Button>
        </form>

        <div className="mt-5">
          {submittedId === null || submittedId.length === 0 ? (
            <p className="text-sm text-content-subtle">Enter a trip ID to view its payment.</p>
          ) : paymentQuery.isPending ? (
            <Loading label="Loading payment…" />
          ) : paymentQuery.isError ? (
            errorView(paymentQuery.error, () => void paymentQuery.refetch())
          ) : payment !== null ? (
            <div className="rounded-2xl border border-border bg-surface-raised p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-content-muted">
                  <CreditCard className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm">{payment.method}</span>
                </span>
                <StatusPill status={payment.status} />
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-content">
                  {payment.amount.toLocaleString()}
                </span>
                <span className="text-sm font-medium text-content-muted">{payment.currency}</span>
              </div>

              <p className="mt-1 text-xs text-content-subtle">Trip {payment.tripId}</p>

              {payment.status === "FAILED" && payment.failureReason ? (
                <div className="mt-4">
                  <ErrorBanner message={payment.failureReason} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
