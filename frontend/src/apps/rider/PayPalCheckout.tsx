/**
 * PayPalCheckout — renders the PayPal button for a fare.
 *
 * Flow: the button asks payment-service to create an order for the fare (the server
 * converts VND to the PayPal currency), the rider approves it in the PayPal popup,
 * and `onApproved` receives the approved order id. Approving only holds funds; the
 * charge is captured when the trip completes. The PayPal JS SDK is loaded once, using
 * the public client id served by payment-service (the secret never reaches the browser).
 */
import { useEffect, useRef, useState } from "react";
import { appConfig } from "../../config/appConfig";
import { resolvePaymentClient } from "../../domain/payment";
import type { PayPalConfig } from "../../domain/payment";
import { friendlyError } from "../../shared/errors";

const paymentClient = resolvePaymentClient(appConfig);

interface PayPalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}

interface PayPalSdk {
  Buttons(options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void> | void;
    onError: (err: unknown) => void;
  }): PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

let sdkPromise: Promise<PayPalSdk> | null = null;

function loadSdk(config: PayPalConfig): Promise<PayPalSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement("script");
    const params = new URLSearchParams({
      "client-id": config.clientId,
      currency: config.currency,
      intent: "authorize",
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK did not load")));
    script.onerror = () => reject(new Error("Could not load the PayPal SDK"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    sdkPromise = null; // allow a retry
    throw err;
  });
  return sdkPromise;
}

export interface PayPalCheckoutProps {
  /** Fare in VND. */
  amount: number;
  onApproved: (orderId: string) => void;
  onError: (message: string) => void;
}

export function PayPalCheckout({ amount, onApproved, onError }: PayPalCheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  // The buttons are rendered once; refs keep the callbacks and amount current.
  const amountRef = useRef(amount);
  const approvedRef = useRef(onApproved);
  const errorRef = useRef(onError);
  amountRef.current = amount;
  approvedRef.current = onApproved;
  errorRef.current = onError;

  useEffect(() => {
    let buttons: PayPalButtons | null = null;
    let cancelled = false;
    paymentClient
      .getPaypalConfig()
      .then(loadSdk)
      .then((sdk) => {
        if (cancelled || !containerRef.current) return;
        buttons = sdk.Buttons({
          createOrder: async () => (await paymentClient.createPaypalOrder(amountRef.current, "VND")).orderId,
          onApprove: (data) => approvedRef.current(data.orderID),
          onError: (err) => errorRef.current(friendlyError(err)),
        });
        return buttons.render(containerRef.current).then(() => setStatus("ready"));
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      void buttons?.close();
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {status === "loading" ? <p className="text-sm text-content-muted">Loading PayPal...</p> : null}
      {status === "unavailable" ? (
        <p className="text-sm text-danger" role="alert">
          PayPal is not available right now. Choose cash instead.
        </p>
      ) : null}
      <div ref={containerRef} aria-label="PayPal checkout" />
    </div>
  );
}
