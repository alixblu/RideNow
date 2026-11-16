import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createNotificationMockClient } from "../domain/notification";
import type { NotificationMockClient } from "../domain/notification";
import { ToastProvider } from "../shared/ui";
import { MAX_BACKOFF_MS, pollDelay, useNotifications } from "./useNotifications";
import { NotificationBell } from "./NotificationBell";

const USER = "11111111-1111-1111-1111-111111111111";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function push(client: NotificationMockClient, message: string, userId = USER) {
  return client.push({ userId, type: "trip.started", message, tripId: null, occurredAt: null });
}

/** Let the poll timers and the resulting promise chains run. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("pollDelay", () => {
  it("doubles per failure and caps at 30s", () => {
    expect(pollDelay(3000, 0)).toBe(3000);
    expect(pollDelay(3000, 1)).toBe(6000);
    expect(pollDelay(3000, 2)).toBe(12000);
    expect(pollDelay(3000, 10)).toBe(MAX_BACKOFF_MS);
  });
});

describe("useNotifications", () => {
  it("loads history, then polls with since= and announces only new items once", async () => {
    const client = createNotificationMockClient();
    const first = push(client, "Looking for a driver near you.");
    const listSince = vi.spyOn(client, "listSince");
    const onNew = vi.fn();

    const { result } = renderHook(() => useNotifications(USER, { client, intervalMs: 3000, onNew }), {
      wrapper,
    });
    await tick(0);

    expect(result.current.items.map((n) => n.id)).toEqual([first.id]);
    expect(listSince).toHaveBeenLastCalledWith(USER, undefined);
    expect(onNew).not.toHaveBeenCalled();

    const second = push(client, "A driver has accepted your trip.");
    await tick(3000);

    expect(listSince).toHaveBeenLastCalledWith(USER, first.id);
    expect(result.current.items.map((n) => n.id)).toEqual([first.id, second.id]);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }));

    // Later polls with nothing new announce nothing.
    await tick(3000);
    expect(listSince).toHaveBeenLastCalledWith(USER, second.id);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("dedupes an item the server returns twice", async () => {
    const client = createNotificationMockClient();
    const item = push(client, "Your trip has started.");
    // A server that ignores the cursor: the same item comes back every time.
    vi.spyOn(client, "listSince").mockImplementation(async () => [{ ...item }]);
    const onNew = vi.fn();

    const { result } = renderHook(() => useNotifications(USER, { client, intervalMs: 1000, onNew }), {
      wrapper,
    });
    await tick(0);
    await tick(1000);
    await tick(1000);

    expect(result.current.items).toHaveLength(1);
    expect(onNew).not.toHaveBeenCalled();
  });

  it("does not poll while the tab is hidden, and refetches when it is shown again", async () => {
    const client = createNotificationMockClient();
    const listSince = vi.spyOn(client, "listSince");

    renderHook(() => useNotifications(USER, { client, intervalMs: 2000 }), { wrapper });
    await tick(0);
    const afterFirstLoad = listSince.mock.calls.length;

    act(() => focusManager.setFocused(false));
    await tick(10_000);
    expect(listSince.mock.calls.length).toBe(afterFirstLoad);

    act(() => focusManager.setFocused(true));
    await tick(0);
    expect(listSince.mock.calls.length).toBeGreaterThan(afterFirstLoad);
  });

  it("backs off after an error", async () => {
    const client = createNotificationMockClient();
    const listSince = vi.spyOn(client, "listSince").mockRejectedValue(new Error("down"));

    renderHook(() => useNotifications(USER, { client, intervalMs: 1000 }), { wrapper });
    await tick(0);
    expect(listSince).toHaveBeenCalledTimes(1);

    // After one failure the next poll waits 2s, not 1s.
    await tick(1000);
    expect(listSince).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(listSince).toHaveBeenCalledTimes(2);
  });

  it("markRead updates the item and the unread count", async () => {
    const client = createNotificationMockClient();
    const item = push(client, "Your trip is complete.");

    const { result } = renderHook(() => useNotifications(USER, { client }), { wrapper });
    await tick(0);
    expect(result.current.unreadCount).toBe(1);

    await act(async () => {
      await result.current.markRead(item.id);
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.items[0]!.readAt).not.toBeNull();
  });
});

describe("NotificationBell", () => {
  it("shows the unread count, toasts a new item, and marks items read from the inbox", async () => {
    const client = createNotificationMockClient();
    push(client, "Looking for a driver near you.");

    render(<NotificationBell userId={USER} intervalMs={2000} client={client} />, { wrapper });
    await tick(0);
    expect(screen.getByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();

    push(client, "Your driver has arrived at the pickup point.");
    await tick(2000);
    expect(screen.getByRole("button", { name: "Notifications (2 unread)" })).toBeInTheDocument();
    expect(screen.getAllByText("Your driver has arrived at the pickup point.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Notifications (2 unread)" }));
    const inbox = screen.getByRole("region", { name: "Inbox" });
    expect(inbox).toHaveTextContent("Looking for a driver near you.");

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]!);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();
  });

  it("shows an empty inbox", async () => {
    render(<NotificationBell userId={USER} client={createNotificationMockClient()} />, { wrapper });
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: "Notifications (0 unread)" }));
    expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
  });
});
