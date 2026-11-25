/**
 * Component tests for driver onboarding (Req 9.2, 9.3, 9.4, 9.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DriverResponse, DriverServiceClient } from "../../domain/driver/contract";
import { ApiError } from "../../http/ApiError";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { saveSession } from "../../identity/sessionStore";
import { ToastProvider } from "../../shared/ui";
import { DriverApp } from "./DriverApp";
import { OnboardingScreen } from "./OnboardingScreen";

vi.mock("../../map/MapCanvas", () => ({ MapCanvas: () => <div data-testid="map" /> }));
vi.mock("./DriveScreen", () => ({ DriveScreen: () => <div data-testid="drive-screen" /> }));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const DRIVER: DriverResponse = {
  id: "driver-1",
  userId: USER_ID,
  licenseNumber: "LIC-123",
  status: "ACTIVE",
  averageRating: null,
  totalTrips: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function makeClient(overrides: Partial<DriverServiceClient> = {}) {
  return {
    createDriver: vi.fn().mockResolvedValue(DRIVER),
    addVehicle: vi.fn().mockResolvedValue({ id: "v-1" }),
    listDrivers: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 }),
    ...overrides,
  } as unknown as DriverServiceClient;
}

function fill(license: string, plate: string, model = "") {
  fireEvent.change(screen.getByLabelText(/license number/i), { target: { value: license } });
  fireEvent.change(screen.getByLabelText(/plate number/i), { target: { value: plate } });
  if (model) fireEvent.change(screen.getByLabelText(/vehicle model/i), { target: { value: model } });
}

beforeEach(() => {
  localStorage.clear();
  saveSession(localStorage, { role: "driver", id: USER_ID });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("OnboardingScreen", () => {
  it("renders the license, vehicle type, plate and model fields (Req 9.2)", () => {
    render(<OnboardingScreen userId={USER_ID} client={makeClient()} onComplete={() => undefined} />);
    expect(screen.getByLabelText(/license number/i)).toBeTruthy();
    expect(screen.getByLabelText(/vehicle type/i)).toBeTruthy();
    expect(screen.getByLabelText(/plate number/i)).toBeTruthy();
    expect(screen.getByLabelText(/vehicle model/i)).toBeTruthy();
  });

  it("creates the driver, adds the vehicle and completes (Req 9.3)", async () => {
    const client = makeClient();
    const onComplete = vi.fn();
    render(<OnboardingScreen userId={USER_ID} client={client} onComplete={onComplete} />);
    fill("LIC-123", "59X1-123.45", "Vision");
    fireEvent.change(screen.getByLabelText(/vehicle type/i), { target: { value: "CAR" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(DRIVER));
    expect(client.createDriver).toHaveBeenCalledWith({ userId: USER_ID, licenseNumber: "LIC-123" });
    expect(client.addVehicle).toHaveBeenCalledWith("driver-1", {
      plateNumber: "59X1-123.45",
      vehicleType: "CAR",
      model: "Vision",
    });
  });

  it("shows the backend message and keeps entered values on failure (Req 9.4)", async () => {
    const addVehicle = vi
      .fn()
      .mockRejectedValueOnce(ApiError.validation("Plate already registered"))
      .mockResolvedValue({ id: "v-1" });
    const client = makeClient({ addVehicle });
    const onComplete = vi.fn();
    render(<OnboardingScreen userId={USER_ID} client={client} onComplete={onComplete} />);
    fill("LIC-123", "59X1-123.45", "Vision");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("Plate already registered");
    expect((screen.getByLabelText(/license number/i) as HTMLInputElement).value).toBe("LIC-123");
    expect((screen.getByLabelText(/plate number/i) as HTMLInputElement).value).toBe("59X1-123.45");
    expect((screen.getByLabelText(/vehicle model/i) as HTMLInputElement).value).toBe("Vision");
    expect(onComplete).not.toHaveBeenCalled();

    // Retry skips the driver step that already succeeded.
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(DRIVER));
    expect(client.createDriver).toHaveBeenCalledTimes(1);
    expect(addVehicle).toHaveBeenCalledTimes(2);
  });

  it("shows an ApiError message when driver creation fails", async () => {
    const createDriver = vi.fn().mockRejectedValue(ApiError.conflict("Driver exists"));
    render(<OnboardingScreen userId={USER_ID} client={makeClient({ createDriver })} onComplete={() => undefined} />);
    fill("LIC-1", "PLATE-1");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("Driver exists");
  });

  it("does not call the backend when required fields are empty", () => {
    const client = makeClient();
    render(<OnboardingScreen userId={USER_ID} client={client} onComplete={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(client.createDriver).not.toHaveBeenCalled();
    expect(screen.getByText(/enter your license number/i)).toBeTruthy();
  });
});

describe("DriverApp gate", () => {
  function renderApp(client: DriverServiceClient) {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <SessionIdentityProvider>
            <DriverApp client={client} />
          </SessionIdentityProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it("skips onboarding when the driver profile already exists (Req 9.5)", async () => {
    const client = makeClient({
      listDrivers: vi.fn().mockResolvedValue({ items: [DRIVER], total: 1, limit: 1, offset: 0 }),
    });
    renderApp(client);
    expect(await screen.findByTestId("drive-screen")).toBeTruthy();
    expect(screen.queryByText(/set up your driver profile/i)).toBeNull();
  });

  it("shows onboarding when no driver profile exists", async () => {
    renderApp(makeClient());
    expect(await screen.findByText(/set up your driver profile/i)).toBeTruthy();
  });
});
