# RideNow Frontend

React + Vite + TypeScript app for riders, drivers and admins. Copy `.env.example` to `.env` for local overrides.

## Running the driver-movement simulation

When a driver accepts a trip, the driver app can simulate the vehicle moving along a route, so the rider's live map can be exercised without a real GPS source.

Environment variables (set in `.env`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Backend origin. The simulation posts driver locations to it, and the rider receives them over `/live`. Locally use the Vite dev proxy, `http://localhost:5173`. Blank uses the per-service path prefix map. | blank |
| `VITE_OSRM_URL` | OSRM server used to route the simulated path along roads. Blank makes the simulation drive a straight line. | blank |
| `VITE_SIM_SPEED_KMH` | Simulated driver speed in km/h. Must be a positive number; invalid or blank values fall back to 30. | `30` |

Steps:

1. Start the backend services and run `pnpm dev` in `frontend/`.
2. Sign in as a driver in one browser window and go online. Sign in as a rider in another window and request a trip.
3. Accept the offer as the driver. The simulation moves the driver toward the pickup, then to the destination, and the rider's map follows.

The public OSRM demo server (`https://router.project-osrm.org`) is for development only.

## Scripts

- `pnpm dev`: start the dev server
- `pnpm build`: type-check and build
- `pnpm test`: run tests
