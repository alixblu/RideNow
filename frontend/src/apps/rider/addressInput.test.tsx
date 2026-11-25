// Unit tests for address search (task 8.8). Requirements 5.2, 5.4, 5.6, 5.7, 5.8, 5.12, 12.4.
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddressInput } from "./AddressInput";
import type { Geocoder, Place } from "../../geocoding/contract";

const A: Place = { address: "1 Main Street", lat: 10.5, lng: 106.25 };
const B: Place = { address: "2 Main Street", lat: 10.75, lng: 106.5 };

function makeGeocoder(overrides: Partial<Geocoder> = {}) {
  const search = vi.fn<Geocoder["search"]>(() => Promise.resolve([A, B]));
  const reverse = vi.fn<Geocoder["reverse"]>(() => Promise.resolve(A));
  const geocoder: Geocoder = { search, reverse, ...overrides };
  return { geocoder, search, reverse };
}

/** Harness binds the Place and exposes the coordinates a map marker would use. */
function Harness({ geocoder, current = false }: { geocoder: Geocoder | null; current?: boolean }) {
  const [value, setValue] = useState<Place | null>(null);
  return (
    <>
      <AddressInput
        id="addr"
        label="Pickup"
        value={value}
        onChange={setValue}
        geocoder={geocoder}
        allowCurrentLocation={current}
      />
      <output data-testid="marker">{value ? `${value.lat},${value.lng}` : "none"}</output>
    </>
  );
}

const input = () => screen.getByRole("combobox") as HTMLInputElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function stubGeolocation(impl: Geolocation["getCurrentPosition"] | undefined) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: impl ? { getCurrentPosition: impl } : undefined,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  stubGeolocation(undefined);
});

describe("address search: debounce (5.2)", () => {
  it("sends one request after 800 ms of inactivity, using the latest text", async () => {
    const { geocoder, search } = makeGeocoder();
    render(<Harness geocoder={geocoder} />);
    type("Mai");
    await advance(500);
    type("Main");
    await advance(799);
    expect(search).not.toHaveBeenCalled();
    await advance(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe("Main");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("does not search for fewer than 3 characters", async () => {
    const { geocoder, search } = makeGeocoder();
    render(<Harness geocoder={geocoder} />);
    type("Ma");
    await advance(2000);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("address search: selection and marker (5.4)", () => {
  it("binds the clicked suggestion, fills the text, closes the list and exposes coordinates", async () => {
    const { geocoder } = makeGeocoder();
    render(<Harness geocoder={geocoder} />);
    type("Main");
    await advance(800);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(screen.getByRole("option", { name: B.address }));
    expect(input().value).toBe(B.address);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("marker").textContent).toBe("10.75,106.5");
  });
});

describe("address search: current location (5.6, 5.7)", () => {
  it("reverse-geocodes the device position and binds the result when allowed", async () => {
    const { geocoder, reverse } = makeGeocoder();
    stubGeolocation((ok) => ok({ coords: { latitude: 10.5, longitude: 106.25 } } as GeolocationPosition));
    render(<Harness geocoder={geocoder} current />);
    fireEvent.click(screen.getByRole("button", { name: /use my current location/i }));
    await advance(0);
    expect(reverse.mock.calls[0]?.slice(0, 2)).toEqual([10.5, 106.25]);
    expect(input().value).toBe(A.address);
    expect(screen.getByTestId("marker").textContent).toBe("10.5,106.25");
  });

  it("shows a message and keeps manual entry when permission is denied", async () => {
    const { geocoder, reverse } = makeGeocoder();
    stubGeolocation((_ok, err) => err?.({ code: 1, message: "denied" } as GeolocationPositionError));
    render(<Harness geocoder={geocoder} current />);
    fireEvent.click(screen.getByRole("button", { name: /use my current location/i }));
    await advance(0);
    expect(screen.getByRole("alert").textContent).toMatch(/current location is unavailable/i);
    expect(reverse).not.toHaveBeenCalled();
    expect(input().disabled).toBe(false);
    expect(screen.getByTestId("marker").textContent).toBe("none");
  });

  it("shows the same message when geolocation is not supported", () => {
    const { geocoder } = makeGeocoder();
    stubGeolocation(undefined);
    render(<Harness geocoder={geocoder} current />);
    fireEvent.click(screen.getByRole("button", { name: /use my current location/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i);
  });
});

describe("address search: no result (5.8)", () => {
  it("shows 'No matching address' and no options", async () => {
    const { geocoder } = makeGeocoder({ search: () => Promise.resolve([]) });
    render(<Harness geocoder={geocoder} />);
    type("zzzz");
    await advance(800);
    expect(screen.getByText("No matching address")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("address search: failure with retry (5.12)", () => {
  it("shows an error with Retry, and Retry re-runs the query", async () => {
    const { geocoder, search } = makeGeocoder();
    search.mockRejectedValueOnce(new Error("boom"));
    render(<Harness geocoder={geocoder} />);
    type("Main");
    await advance(800);
    expect(screen.getByText("Address search failed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(1000); // honours the 1 request per second ceiling
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0]).toBe("Main");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByText("Address search failed.")).toBeNull();
  });
});

describe("address search: keyboard handling (12.4)", () => {
  async function openList() {
    const { geocoder } = makeGeocoder();
    render(<Harness geocoder={geocoder} />);
    type("Main");
    await advance(800);
  }

  it("moves the active option with ArrowDown/ArrowUp and wraps", async () => {
    await openList();
    const opts = screen.getAllByRole("option");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(opts[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(opts[0]?.id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(opts[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(opts[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(opts[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("selects the active option with Enter", async () => {
    await openList();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input().value).toBe(B.address);
    expect(screen.getByTestId("marker").textContent).toBe("10.75,106.5");
  });

  it("does nothing on Enter when no option is active", async () => {
    await openList();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByTestId("marker").textContent).toBe("none");
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the list with Escape without selecting", async () => {
    await openList();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("marker").textContent).toBe("none");
  });
});
