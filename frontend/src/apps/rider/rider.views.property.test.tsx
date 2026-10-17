/**
 * Property test for Property 9: Payment and notification views render all contract
 * fields. Task 18.2.
 *
 * Tag: Feature: ridenow-frontend, Property 9: Payment and notification views render all contract fields
 *
 * Validates: Requirements 11.1, 12.1.
 *
 * Property 9 has two halves:
 *   - For any PaymentResponse, the payment view renders amount, currency, method, and
 *     Payment_Status.
 *   - For any list of NotificationResponse, the notifications view renders each
 *     notification's message and timestamp.
 *
 * Both rider screens resolve their Service_Client internally from appConfig and read the
 * rider identity from context, so we drive them through a stubbed client (via vi.mock)
 * and a DevIdentityProvider with a rider identity set. fast-check generates the data and
 * we assert each contract field appears in the rendered DOM.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import type { ReactElement } from "react";
import fc from "fast-check";
import { MemoryRouter } from "react-router-dom";
import type { PaymentResponse } from "../../domain/payment";
import type { NotificationResponse } from "../../domain/notification";
import { PAYMENT_STATUS_VALUES } from "../../shared/enums";

// --- Stub the payment and notification domain clients the screens resolve. --------
// Declared via vi.hoisted so they exist before the hoisted vi.mock factories run.
const { getPaymentForTrip, listForIdentity } = vi.hoisted(() => ({
  getPaymentForTrip: vi.fn<(tripId: string) => Promise<PaymentResponse>>(),
  listForIdentity: vi.fn<(identityId: string) => Promise<NotificationResponse[]>>(),
}));

vi.mock("../../domain/payment", () => ({
  resolvePaymentClient: () => ({ getPaymentForTrip }),
}));
vi.mock("../../domain/notification", () => ({
  resolveNotificationClient: () => ({ listForIdentity }),
}));

// Import screens AFTER the mocks so they pick up the stubbed clients.
import { PaymentScreen } from "./PaymentScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { DevIdentityProvider } from "../../identity/DevIdentityProvider";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

/** A harness that sets a rider identity, then renders the screen under test. */
function RiderHarness({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const hasIdentity = identity.current("rider") !== null;
  useEffect(() => {
    if (!hasIdentity) {
      identity.set({ role: "rider", id: "rider-1" });
    }
  }, [hasIdentity, identity]);
  // Render children only once the identity is set, so the screen's query runs with it.
  return hasIdentity ? children : null;
}

function renderRider(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DevIdentityProvider>
          <RiderHarness>{ui}</RiderHarness>
        </DevIdentityProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const paymentArb: fc.Arbitrary<PaymentResponse> = fc.record({
  id: fc.string({ minLength: 1 }).map((s) => "pay-" + s.replace(/\s/g, "")),
  tripId: fc.string({ minLength: 1 }).map((s) => "trip-" + s.replace(/\s/g, "")),
  amount: fc.integer({ min: 0, max: 5_000_000 }),
  currency: fc.constantFrom("VND", "USD", "EUR"),
  method: fc.constantFrom("CASH", "SIMULATED_CARD"),
  // Use PAID so the FAILED-only failureReason branch is not required here.
  status: fc.constantFrom(...PAYMENT_STATUS_VALUES.filter((s) => s !== "FAILED")),
  failureReason: fc.constant(null),
  createdAt: fc.constant("2024-01-01T00:00:00.000Z"),
  updatedAt: fc.constant("2024-01-01T00:00:00.000Z"),
});

describe("Feature: ridenow-frontend, Property 9: Payment and notification views render all contract fields", () => {
  it("payment view renders amount, currency, method, and status for any PaymentResponse", async () => {
    await fc.assert(
      fc.asyncProperty(paymentArb, async (payment) => {
        cleanup();
        getPaymentForTrip.mockResolvedValue(payment);

        renderRider(<PaymentScreen activeTripId={payment.tripId} />);

        // The amount (locale-formatted), currency, method, and humanized status must
        // all be visible once the query resolves.
        await waitFor(() => {
          expect(
            screen.getAllByText(payment.amount.toLocaleString()).length,
          ).toBeGreaterThan(0);
        });
        expect(screen.getAllByText(payment.currency).length).toBeGreaterThan(0);
        expect(screen.getAllByText(payment.method).length).toBeGreaterThan(0);
        // Status is rendered via StatusPill which humanizes e.g. PAID -> "Paid".
        const humanized =
          payment.status.charAt(0) + payment.status.slice(1).toLowerCase();
        expect(screen.getAllByText(humanized).length).toBeGreaterThan(0);
      }),
      { numRuns: 25 },
    );
  });

  it("notifications view renders each notification's message and timestamp", async () => {
    const notificationsArb = fc.array(
      fc.record({
        id: fc.string({ minLength: 1 }).map((s) => "n-" + s.replace(/\s/g, "")),
        recipientId: fc.constant("rider-1"),
        message: fc
          .string({ minLength: 1, maxLength: 40 })
          .map((s) => "Msg " + s.replace(/[^\x21-\x7e]/g, "a")),
        createdAt: fc.constant("2024-03-04T08:30:00.000Z"),
      }),
      { minLength: 1, maxLength: 4 },
    );

    await fc.assert(
      fc.asyncProperty(notificationsArb, async (notifications) => {
        cleanup();
        listForIdentity.mockResolvedValue(notifications);

        renderRider(<NotificationsScreen />);

        await waitFor(() => {
          const list = screen.getByLabelText("Notifications");
          // Each message is rendered.
          for (const n of notifications) {
            expect(within(list).getAllByText(n.message).length).toBeGreaterThan(0);
          }
          // Each notification contributes a <time> element carrying its timestamp.
          const times = list.querySelectorAll("time");
          expect(times.length).toBe(notifications.length);
          for (const n of notifications) {
            const match = Array.from(times).some(
              (t) => t.getAttribute("dateTime") === n.createdAt,
            );
            expect(match).toBe(true);
          }
        });
      }),
      { numRuns: 20 },
    );
  });
});
