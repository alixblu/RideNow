/**
 * Unit tests for Task 18.3 — rider matching-in-progress, payment failure, and
 * notifications empty-state.
 *
 * Tag: Feature: ridenow-frontend, Task 18.3: rider matching / payment-failure / empty-state
 *
 * Covers three concrete rider behaviors against the redesigned screens:
 *   - Req 10.1: while a trip is SEARCHING, the matching screen shows a
 *     matching-in-progress view.
 *   - Req 11.3: a FAILED payment surfaces its failure reason.
 *   - Req 12.2: when the rider has no notifications, the empty-state is shown.
 *
 * The rider screens resolve their Service_Client internally and read the rider identity
 * from context, so we stub the clients via vi.mock and set a rider identity through the
 * DevIdentityProvider.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { PaymentResponse } from "../../domain/payment";
import type { NotificationResponse } from "../../domain/notification";
import type { MatchResult } from "../../domain/matching";

// Declared via vi.hoisted so they are initialized before the hoisted vi.mock factories
// run (a plain top-level const would not yet exist when the factory executes).
const { getPaymentForTrip, listForIdentity, getMatchState } = vi.hoisted(() => ({
  getPaymentForTrip: vi.fn<(tripId: string) => Promise<PaymentResponse>>(),
  listForIdentity: vi.fn<(identityId: string) => Promise<NotificationResponse[]>>(),
  getMatchState: vi.fn<(tripId: string) => Promise<MatchResult>>(),
}));

vi.mock("../../domain/payment", () => ({
  resolvePaymentClient: () => ({ getPaymentForTrip }),
}));
vi.mock("../../domain/notification", () => ({
  resolveNotificationClient: () => ({ listForIdentity }),
}));
vi.mock("../../domain/matching", () => ({
  resolveMatchingClient: () => ({ getMatchState }),
}));

import { PaymentScreen } from "./PaymentScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { MatchingScreen } from "./MatchingScreen";
import { DevIdentityProvider } from "../../identity/DevIdentityProvider";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

function RiderHarness({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const hasIdentity = identity.current("rider") !== null;
  useEffect(() => {
    if (!hasIdentity) {
      identity.set({ role: "rider", id: "rider-1" });
    }
  }, [hasIdentity, identity]);
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

describe("Feature: ridenow-frontend, Task 18.3: rider matching / payment-failure / empty-state", () => {
  it("shows a matching-in-progress view while the trip is SEARCHING (Req 10.1)", async () => {
    getMatchState.mockResolvedValue({
      tripId: "trip-1",
      status: "SEARCHING",
      assignedDriver: null,
    });

    renderRider(<MatchingScreen activeTripId="trip-1" />);

    // The searching view surfaces its in-progress copy and the SEARCHING pill.
    await waitFor(() => {
      expect(screen.getByText(/searching for a nearby driver/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Searching")).toBeInTheDocument();
  });

  it("surfaces the failure reason for a FAILED payment (Req 11.3)", async () => {
    getPaymentForTrip.mockResolvedValue({
      id: "pay-1",
      tripId: "trip-1",
      amount: 120000,
      currency: "VND",
      method: "SIMULATED_CARD",
      status: "FAILED",
      idempotencyKey: "idem-trip-1",
      failureReason: "Payment declined by the card issuer.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      paidAt: null,
      failedAt: "2024-01-01T00:00:00.000Z",
    });

    renderRider(<PaymentScreen activeTripId="trip-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("Payment declined by the card issuer."),
      ).toBeInTheDocument();
    });
    // The FAILED status is also shown (humanized).
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows the empty-state when the rider has no notifications (Req 12.2)", async () => {
    listForIdentity.mockResolvedValue([]);

    renderRider(<NotificationsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/you have no notifications yet/i)).toBeInTheDocument();
    });
    // No notifications list is rendered in the empty state.
    expect(screen.queryByLabelText("Notifications")).not.toBeInTheDocument();
  });
});
