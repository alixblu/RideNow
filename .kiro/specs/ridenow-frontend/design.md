# Design Document

## Overview

RideNow Frontend is a single React + TypeScript + Vite application that hosts three
in-shell experiences — Rider_App, Driver_App, and Admin_Console — behind client-side
routing. It is a new top-level app in the monorepo (`frontend/`), built and run
independently of any Spring Boot service. There is no Spring Boot code here.

The frontend reaches backend microservices through a single configurable
`API_Base_URL` (gateway-style). Because no gateway exists yet, a local
`Path_Prefix_Map` fallback maps HTTP path prefixes to individual service origins.
Every backend domain is accessed through a per-service `Service_Client` whose
contract is identical for a `Live_Client` (real HTTP) and a `Mock_Client`
(in-memory). Implementation selection is by configuration, per domain. Stubbed
screens render identically to live ones and carry no visible mock/live marker.

Live domains: driver, vehicle (both served by driver-service), and user (user-service).
Stubbed domains: trip, matching, payment, notification — mock-only today, behind a
documented future contract so each can become drop-in live later.

Authentication is out of scope. A development-only `Identity_Switcher` sets the
`Current_Identity` and is hidden behind a replaceable module boundary so real auth
can supply the identity later without touching calling screens.

### Technology choices (and why)

The requirements leave styling, component approach, and data fetching open. The
choices below favor minimal, well-known dependencies and a small learning surface,
consistent with the monorepo's "clear conventional code over architecture fashions"
posture.

| Concern | Choice | Justification |
| --- | --- | --- |
| Build/dev | Vite | Locked decision; fast dev server and first-class React + TS support. |
| Language | TypeScript (strict) | Locked decision; typed DTOs that mirror backend records. |
| Routing | React Router (`react-router-dom`) | De-facto standard for client-side routing; nested routes map cleanly to the three-app shell and a catch-all not-found route. |
| Data fetching | TanStack Query (`@tanstack/react-query`) | Gives loading/error/retry states (Req 13) out of the box without hand-rolled state machines. It wraps the `Service_Client` calls; it does not replace the client abstraction. |
| HTTP | Native `fetch` inside the request layer | No extra dependency; the request layer centralizes URL resolution and error normalization. |
| Styling | Plain CSS Modules + a tiny shared layout | No component-library dependency to learn or theme; keeps bundle small and leaves screens visually uniform so mock and live screens look identical (Req 4.5). |
| Validation | Lightweight inline form validation (no schema lib initially) | Forms are small (2–5 fields); a schema library is not justified yet. The request/response types remain the single source of shape truth. |

Rationale for keeping fetching and HTTP separate from the `Service_Client`:
TanStack Query and `fetch` are infrastructure. The `Service_Client` is the domain
contract. Screens depend only on the contract, so swapping Live/Mock never touches a
screen (Req 4.3).

## Project structure

```text
frontend/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  .env                      # VITE_API_BASE_URL, VITE_* mode flags (local, gitignored)
  .env.example              # documented defaults
  src/
    main.tsx                # app entry: router + QueryClient providers
    App.tsx                 # App_Shell composition (nav + <Outlet/>)
    config/
      appConfig.ts          # reads API_Base_URL + per-domain Live/Mock flags from env
      pathPrefixMap.ts      # Path_Prefix_Map: prefix -> service origin (+ placeholders)
    http/
      resolveUrl.ts         # prefix -> origin resolution (gateway vs fallback)
      httpClient.ts         # fetch wrapper: builds URL, applies principal, normalizes errors
      ApiError.ts           # normalized client-facing error type (no stack traces)
    identity/
      IdentityContext.tsx   # replaceable module boundary for Current_Identity
      useCurrentIdentity.ts # hook screens call (stable contract)
      DevIdentityProvider.tsx # dev-only switcher implementation
      types.ts              # Identity, Role
    domain/
      driver/
        contract.ts         # DriverServiceClient interface + request/response types
        liveClient.ts       # Live_Client (real HTTP via httpClient)
        mockClient.ts       # Mock_Client (in-memory)
        index.ts            # resolveDriverClient(config)
      vehicle/              # same shape (driver-service owns vehicles)
      user/
      trip/                 # STUBBED (mock only today)
      matching/             # STUBBED
      payment/              # STUBBED
      notification/         # STUBBED
      clientFactory.ts      # generic Live/Mock selection by per-domain config
    apps/
      rider/                # Rider_App screens + routes
      driver/               # Driver_App screens + routes
      admin/                # Admin_Console screens + routes
    shared/
      ui/                   # Loading, ErrorBanner, Unavailable+Retry, NotFound, EmptyState
      layout/               # shell chrome, nav, active-area indicator
      enums.ts              # DriverStatus, VehicleType, TripStatus, PaymentStatus
    routes.tsx              # route table incl. catch-all not-found
  src/__tests__/            # Vitest unit + property tests
```

One top-level app, built with `vite build`, runnable with `vite dev` independently of
any backend (Req 1.5).

## Architecture

```text
            ┌─────────────────────────────────────────────────────┐
            │                     App_Shell                        │
            │   nav + active indicator + <Outlet/> (React Router)  │
            └───────────────┬───────────────┬─────────────────────┘
                 Rider_App   │   Driver_App  │   Admin_Console
                             ▼               ▼
                    ┌───────────────────────────────┐
                    │  Screens (depend on contracts) │
                    └───────────────┬───────────────┘
                                    │ useCurrentIdentity()
                                    ▼
                    ┌───────────────────────────────┐
                    │  Identity module (boundary)    │  dev switcher today,
                    └───────────────────────────────┘  real auth later
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Service_Client (per domain)   │  Live | Mock by config
                    │  driver/vehicle/user = live    │
                    │  trip/matching/payment/notif.  │
                    │         = mock (stubbed)       │
                    └───────────────┬───────────────┘
                     Live path only │
                                    ▼
                    ┌───────────────────────────────┐
                    │  http: resolveUrl + httpClient │  gateway or Path_Prefix_Map
                    └───────────────┬───────────────┘
                                    ▼
                driver-service (8080) · user-service (8081) · (future gateway)
```

### App-shell composition and routing

`App.tsx` renders shell chrome: a top nav with Rider / Driver / Admin entries, the
`Identity_Switcher`, and a React Router `<Outlet/>`. Each app area is a nested route
subtree. The active area is highlighted via `NavLink` active state (Req 1.2). A
catch-all `*` route renders `NotFound` with links back to each area (Req 1.4).

```tsx
// routes.tsx (shape)
const router = createBrowserRouter([
  { path: "/", element: <AppShell />, children: [
    { index: true, element: <Navigate to="/rider" replace /> },
    { path: "rider/*",  element: <RiderApp /> },
    { path: "driver/*", element: <DriverApp /> },
    { path: "admin/*",  element: <AdminConsole /> },
    { path: "*", element: <NotFound /> },
  ]},
]);
```

`Current_Identity` lives in a React context provider mounted above the router, so
navigating between areas never unmounts it — the selection is preserved (Req 1.3).

### Identity module boundary

`useCurrentIdentity()` is the only surface screens use. Its backing provider is
swappable:

```ts
// identity/types.ts
export type Role = "rider" | "driver" | "admin";
export interface Identity { role: Role; id: string; }

// identity/useCurrentIdentity.ts — the stable contract screens consume
export interface IdentityApi {
  current(role: Role): Identity | null;
  set(identity: Identity): void;   // dev switcher uses this; real auth may omit it
}
```

Today `DevIdentityProvider` implements `IdentityApi` with in-memory React state and a
small switcher UI. Later, a `CognitoIdentityProvider` (or similar) implements the same
`IdentityApi` and is mounted in `main.tsx` instead — no screen changes (Req 2.5). The
app stores no tokens or credentials and has no login/signup flow (Req 2.6). When a role
has no identity, screens that need one render a "set your identity" prompt via a shared
guard component (Req 2.4).

### Configuration module

```ts
// config/appConfig.ts
export interface DomainClientMode { mode: "live" | "mock"; }
export interface AppConfig {
  apiBaseUrl: string | null;        // gateway origin; null => use Path_Prefix_Map
  clients: Record<DomainKey, DomainClientMode>;
}
```

`apiBaseUrl` is read once at startup from `import.meta.env.VITE_API_BASE_URL`
(Req 3.1). Per-domain mode flags come from env too (e.g. `VITE_CLIENT_DRIVER=live`,
`VITE_CLIENT_TRIP=mock`), defaulting live domains to `live` and stubbed domains to
`mock`.

```ts
// config/pathPrefixMap.ts
export const PATH_PREFIX_MAP: Record<string, string | null> = {
  "/api/drivers":       "http://localhost:8080",  // driver-service
  "/api/vehicles":      "http://localhost:8080",  // driver-service
  "/api/users":         "http://localhost:8081",  // user-service
  // Documented placeholders — no service yet (Req 3.4). Live mode for these
  // will 503 at the request layer until an origin is provided.
  "/api/trips":         null, // trip-service (future)
  "/api/matching":      null, // matching-service (future)
  "/api/payments":      null, // payment-service (future)
  "/api/notifications": null, // notification-worker (future)
};
```

### Request layer (prefix resolution)

`resolveUrl(path, config)` decides the origin:

- Gateway mode (`apiBaseUrl` set): origin is `apiBaseUrl`, path preserved unchanged
  (Req 3.2).
- Fallback mode (`apiBaseUrl` null): choose the **longest matching prefix** in
  `PATH_PREFIX_MAP` and use its origin (Req 3.3). A matched-but-null origin
  (placeholder) throws a normalized "service unavailable" error so stubbed-but-
  configured-live domains fail cleanly rather than hitting a wrong host.

```ts
// http/resolveUrl.ts (shape)
export function resolveUrl(path: string, config: AppConfig): string {
  if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/$/, "") + path;
  const prefix = Object.keys(PATH_PREFIX_MAP)
    .filter((p) => path === p || path.startsWith(p + "/") || path.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  const origin = prefix ? PATH_PREFIX_MAP[prefix] : undefined;
  if (!origin) throw ApiError.unavailable(`No origin mapped for ${path}`);
  return origin + path;
}
```

Because resolution is driven entirely by config + the map, changing either reroutes
requests with no change to calling screens (Req 3.5). `httpClient` wraps `fetch`:
resolves the URL, attaches the acting principal when a request requires one (e.g. a
`X-RideNow-Identity` header or query param derived from `Current_Identity`, Req 2.3),
and normalizes every failure into `ApiError`.

### Service_Client contract pattern

Each domain exposes an interface plus request/response types. Live and Mock implement
the same interface, so screens are implementation-agnostic (Req 4.1, 4.3).

```ts
// domain/driver/contract.ts
export interface DriverServiceClient {
  createDriver(req: CreateDriverRequest): Promise<DriverResponse>;
  getDriver(id: string): Promise<DriverResponse>;          // 404 -> ApiError.notFound
  addVehicle(driverId: string, req: CreateVehicleRequest): Promise<VehicleResponse>;
  listVehicles(driverId: string): Promise<VehicleResponse[]>;
  changeStatus(driverId: string, status: DriverStatus): Promise<DriverResponse>;
  getVehicle(id: string): Promise<VehicleResponse>;
}
```

A single generic factory selects the implementation by per-domain config (Req 4.2):

```ts
// domain/clientFactory.ts
export function resolveClient<T>(mode: "live" | "mock", live: () => T, mock: () => T): T {
  return mode === "live" ? live() : mock();
}
```

`Mock_Client` methods return objects that satisfy the exact same response types as
`Live_Client`, so a stubbed screen renders identically and shows no mock/live marker
(Req 4.4, 4.5). Mock data is held in a per-domain in-memory store seeded at module load.

### Typed models and DTOs (matching backend contracts)

Types mirror the inspected driver-service records and the documented user-service
contract. All IDs are UUID strings. Timestamps are ISO-8601 strings (Jackson serializes
`Instant` as ISO-8601).

```ts
// shared/enums.ts
export type DriverStatus = "ACTIVE" | "SUSPENDED";
export type VehicleType  = "MOTORBIKE" | "CAR";
export type TripStatus =
  | "REQUESTED" | "SEARCHING" | "DRIVER_ASSIGNED" | "DRIVER_ARRIVED"
  | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type PaymentStatus = "PENDING" | "PROCESSING" | "PAID" | "FAILED";
```

Driver domain (LIVE — from `DriverController`, `CreateDriverRequest`,
`CreateVehicleRequest`, `DriverResponse`, `VehicleResponse`):

```ts
// domain/driver/contract.ts — requests
export interface CreateDriverRequest  { userId: string; licenseNumber: string; }
export interface CreateVehicleRequest {
  plateNumber: string; vehicleType: VehicleType;
  brand?: string; model?: string; color?: string;
}

// responses (field names and types match the Java records exactly)
export interface DriverResponse {
  id: string; userId: string; licenseNumber: string; status: DriverStatus;
  averageRating: number | null;   // BigDecimal -> JSON number, nullable per DBML
  totalTrips: number;             // long
  createdAt: string; updatedAt: string; // Instant -> ISO-8601
}
export interface VehicleResponse {
  id: string; driverId: string; plateNumber: string; vehicleType: VehicleType;
  brand: string | null; model: string | null; color: string | null;
  active: boolean; createdAt: string; updatedAt: string;
}
```

Endpoint mapping (driver-service, prefix-resolved):

| Operation | Method + path |
| --- | --- |
| Create driver | `POST /api/drivers` body `{userId, licenseNumber}` → 201 `DriverResponse` |
| Get driver | `GET /api/drivers/{id}` → `DriverResponse` (404 if missing) |
| Add vehicle | `POST /api/drivers/{driverId}/vehicles` → 201 `VehicleResponse` |
| List vehicles | `GET /api/drivers/{driverId}/vehicles` → `VehicleResponse[]` |
| Change status | `PATCH /api/drivers/{driverId}/status?status=ACTIVE\|SUSPENDED` → `DriverResponse` |
| Get vehicle | `GET /api/vehicles/{id}` → `VehicleResponse` |

User domain (LIVE — user-service currently exposes create + get only; shape taken from
stage-04 guide and the `users` DBML table):

```ts
// domain/user/contract.ts
export interface CreateUserRequest {
  cognitoSub: string; email: string; fullName: string;
  phone?: string; avatarUrl?: string;
}
export interface UserResponse {
  id: string; cognitoSub: string; email: string; phone: string | null;
  fullName: string; avatarUrl: string | null; status: "ACTIVE" | "SUSPENDED";
  createdAt: string; updatedAt: string;
}
export interface UserServiceClient {
  createUser(req: CreateUserRequest): Promise<UserResponse>; // POST /api/users
  getUser(id: string): Promise<UserResponse>;                // GET  /api/users/{id}
}
```

Note: user-service surfaces are confined to create-user and get-user (Req 8.5). The
exact `UserResponse` is inferred from the DBML `users` table and the stage-04 guide
(which creates users with `cognitoSub`, `email`, `fullName` and reads back `.id`);
if the implemented DTO differs when user-service source lands, these types are the
single place to reconcile.

Stubbed domains (mock-only today, documented future contract). Shapes are drawn from
the DBML so a future Live_Client can match them:

```ts
// domain/trip/contract.ts  (STUBBED) — no live-location/real-time fields
export interface CreateTripRequest {
  passengerId: string; rideType: VehicleType;
  pickupLat: number; pickupLng: number;
  destinationLat: number; destinationLng: number;
}
export interface TripResponse {
  id: string; passengerId: string; driverId: string | null; vehicleId: string | null;
  rideType: VehicleType; status: TripStatus;
  pickupLat: number; pickupLng: number;
  destinationLat: number; destinationLng: number;
  estimatedFare: number | null; finalFare: number | null;
  cancellationReason: string | null;
  requestedAt: string; createdAt: string; updatedAt: string;
}
export interface TripServiceClient {
  requestTrip(req: CreateTripRequest): Promise<TripResponse>; // status REQUESTED
  getTrip(id: string): Promise<TripResponse>;
  cancelTrip(id: string): Promise<TripResponse>;              // status CANCELLED
}

// domain/matching/contract.ts (STUBBED)
export interface MatchResult { tripId: string; status: TripStatus; assignedDriver: AssignedDriver | null; }
export interface AssignedDriver { driverId: string; vehicleId: string; summary: string; }
export interface MatchingServiceClient {
  getMatchState(tripId: string): Promise<MatchResult>;        // SEARCHING -> DRIVER_ASSIGNED
}

// domain/payment/contract.ts (STUBBED)
export interface PaymentResponse {
  id: string; tripId: string; amount: number; currency: string; // DBML default VND
  method: "CASH" | "SIMULATED_CARD"; status: PaymentStatus;
  failureReason: string | null;
  createdAt: string; updatedAt: string;
}
export interface PaymentServiceClient { getPaymentForTrip(tripId: string): Promise<PaymentResponse>; }

// domain/notification/contract.ts (STUBBED)
export interface NotificationResponse { id: string; recipientId: string; message: string; createdAt: string; }
export interface NotificationServiceClient { listForIdentity(identityId: string): Promise<NotificationResponse[]>; }
```

No ratings surface is wired to a real API, consistent with ratings ownership being
undecided. No WebSocket/real-time/live-location modules exist (Req 9.6).

### Error, loading, and unavailable handling

TanStack Query exposes `isPending` / `isError` per query, which shared UI components
render consistently:

- Loading: while a request is pending, the affected screen area shows a `Loading`
  indicator (Req 13.1).
- Client error (4xx): `httpClient` parses the backend `ApiErrorResponse`
  (`{timestamp, status, error, message, path}`) and produces an `ApiError` carrying a
  **sanitized** user-facing message. The UI shows that message and never renders stack
  traces or persistence internals (Req 13.2). Known mappings: 404 → not-found view
  (Req 5.4, 7.3, 8.4), 409 → conflict message (Req 5.5, 6.6), 400 → field/validation
  message surfaced near the form.
- Service unavailable: a network failure, timeout, or 503 (including a null
  placeholder origin) produces `ApiError.unavailable`, and the UI shows a
  service-unavailable message with a Retry action that re-runs the query (Req 13.3).

Error normalization is sanitized by construction: `ApiError` only ever holds a status,
a short code, and a curated message. Raw backend bodies are not passed to the view.

Client-side form validation blocks submission and shows field-level messages before
any request is sent (Req 5.2, 6.2, 8.2). `Vehicle_Type`, `Driver_Status`, and trip
ride type selectors are constrained to their enum values in the UI (Req 6.3, 7.1).

### How a stubbed domain becomes drop-in live

Each stubbed domain already ships: (1) a contract interface, (2) a `Mock_Client`, and
(3) a `resolve<Domain>Client(config)` entry wired to the factory. To go live:

1. Implement `Live_Client` against the contract using `httpClient` and the domain's
   path prefix (e.g. `/api/trips`).
2. Set the real origin for that prefix in `PATH_PREFIX_MAP` (or point everything at the
   gateway via `API_Base_URL`).
3. Flip the domain's config flag from `mock` to `live`
   (e.g. `VITE_CLIENT_TRIP=live`).

No screen changes are needed because screens depend only on the contract (Req 4.3), and
the Mock already conforms to the same response shapes the Live_Client will return
(Req 4.4, 9.5, 10.3, 11.4, 12.3).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should
do. Properties serve as the bridge between human-readable specifications and
machine-verifiable correctness guarantees.*

Reflection: rendering-completeness criteria (5.3, 6.4, 6.5, 8.3, 11.1, 12.1) were
consolidated into a single parameterized "detail view renders all contract fields"
property family (Properties 7–9). The required-field validation criteria (5.2, 6.2,
8.2) were consolidated into one validation property (Property 5). Enum-restriction
criteria (6.3, 7.1) were consolidated into one enum-validation property (Property 6).
Error-sanitization criteria (5.5, 6.6, 13.2) were consolidated into Property 12. The
trip initial-status (9.1) and status-domain (9.2) criteria remain distinct because one
is about creation and the other is an invariant over any trip.

### Property 1: Identity preserved across navigation

*For any* `Current_Identity` and *any* sequence of navigations among Rider_App,
Driver_App, and Admin_Console, the `Current_Identity` read after the sequence equals the
one set before it.

**Validates: Requirements 1.3**

### Property 2: Unknown routes resolve to not-found

*For any* requested path that does not match a defined application route, the
App_Shell renders the not-found view and provides at least one navigation target back
to a valid application area.

**Validates: Requirements 1.4**

### Property 3: Identity set/get round-trip

*For any* role and *any* non-empty identifier string, setting the identity through the
identity module and then reading the current identity for that role returns the same
role and identifier.

**Validates: Requirements 2.2, 2.5**

### Property 4: Acting principal equals Current_Identity

*For any* `Current_Identity` and *any* request that requires a principal, the request
produced by the request layer carries an acting principal equal to that
`Current_Identity`.

**Validates: Requirements 2.3**

### Property 5: Missing required fields block submission

*For any* create form (driver, vehicle, or user) with at least one required field
omitted or blank, submission is prevented and a field-level validation message is shown
for each missing required field, and no backend request is issued.

**Validates: Requirements 5.2, 6.2, 8.2**

### Property 6: Only allowed enum values validate

*For any* candidate string value, it validates as a `Vehicle_Type` only if it is
`MOTORBIKE` or `CAR`, and as a `Driver_Status` only if it is `ACTIVE` or `SUSPENDED`.

**Validates: Requirements 6.3, 7.1**

### Property 7: Driver detail renders all contract fields

*For any* `DriverResponse`, the driver detail view renders the driver id, user id,
license number, Driver_Status, average rating, total trips, and both timestamps.

**Validates: Requirements 5.3**

### Property 8: Vehicle rendering is complete

*For any* list of `VehicleResponse` values (and for any single vehicle opened by id),
the vehicle view renders each vehicle's plate number, Vehicle_Type, brand, model,
color, and active state.

**Validates: Requirements 6.4, 6.5**

### Property 9: Payment and notification views render all contract fields

*For any* `PaymentResponse`, the payment view renders amount, currency, method, and
Payment_Status; and *for any* list of `NotificationResponse`, the notifications view
renders each notification's message and timestamp.

**Validates: Requirements 11.1, 12.1**

### Property 10: URL resolution follows active configuration

*For any* request path and *any* configuration: when a gateway `API_Base_URL` is set,
the resolved origin equals `API_Base_URL` and the documented path is preserved; when no
gateway is set, the resolved origin equals the origin of the longest matching prefix in
the `Path_Prefix_Map` (`/api/drivers` and `/api/vehicles` → driver-service,
`/api/users` → user-service).

**Validates: Requirements 3.2, 3.3, 3.5**

### Property 11: Mock responses conform to the shared contract

*For any* Service_Client method invoked with valid generated input, the value returned
by the `Mock_Client` satisfies the same response type/shape as the corresponding
`Live_Client`, so a screen rendered from mock data is indistinguishable from one
rendered from live data.

**Validates: Requirements 4.4, 4.5**

### Property 12: Client errors are sanitized

*For any* backend error payload (including bodies containing stack-trace-like or
persistence-internal text), the user-facing error message produced by the request layer
excludes stack traces and persistence internals and preserves only a curated,
human-readable message.

**Validates: Requirements 5.5, 6.6, 13.2**

### Property 13: New trip starts REQUESTED and echoes its request

*For any* valid trip request (pickup and destination coordinates and a ride type), the
trip returned by the trip Service_Client has Trip_Status `REQUESTED` and echoes the
submitted coordinates and ride type.

**Validates: Requirements 9.1**

### Property 14: Trip status is always within the defined set

*For any* trip produced or returned by the trip Service_Client, its Trip_Status is one
of REQUESTED, SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, or
CANCELLED.

**Validates: Requirements 9.2**

### Property 15: Trip read-back round-trip

*For any* trip created through the trip Service_Client, requesting that trip by its id
returns a trip with the same id, coordinates, and ride type.

**Validates: Requirements 9.3**

### Property 16: Cancelling an eligible trip yields CANCELLED

*For any* trip in a cancellation-eligible state, cancelling it through the trip
Service_Client returns the trip with Trip_Status `CANCELLED`.

**Validates: Requirements 9.4**

### Property 17: Resolved match yields an assigned driver and DRIVER_ASSIGNED

*For any* trip whose matching resolves, the matching Service_Client result contains an
assigned-driver summary and presents the trip with Trip_Status `DRIVER_ASSIGNED`.

**Validates: Requirements 10.2**

### Property 18: Payment status within set, and failures carry a reason

*For any* payment returned by the payment Service_Client, its Payment_Status is one of
PENDING, PROCESSING, PAID, or FAILED; and for any payment whose status is FAILED, a
non-empty failure reason is present and rendered.

**Validates: Requirements 11.2, 11.3**

## Testing Strategy

Test runner: Vitest with React Testing Library; property tests use `fast-check`.

- **Property tests** (fast-check, ≥100 iterations each) cover the properties above.
  Each test is tagged `Feature: ridenow-frontend, Property {number}: {property_text}`.
  Pure/logic-heavy targets — URL resolution (P10), error sanitization (P12), enum
  validation (P6), identity round-trip (P3/P4), and the stubbed mock clients
  (P11, P13–P18) — are ideal because behavior varies meaningfully across generated
  inputs and iterations are cheap (in-memory).
- **Unit / web-slice tests** cover concrete examples and edge cases: shell navigation
  and active indicator (1.1, 1.2), identity prompt empty-state (2.4), 404 not-found
  mappings (5.4, 7.3, 8.4, 9.3 open-missing), conflict messages (5.5, 6.6), loading
  indicator (13.1), unavailable + retry (13.3), notifications empty-state (12.2), and
  matching-in-progress view (10.1).
- **Smoke / structural checks**: the app builds and runs standalone (1.5), the user
  client exposes only create/get (8.5), no token/credential storage exists (2.6), no
  real-time/live-location modules are referenced by trip screens (9.6), and Live/Mock
  implementations share one interface per domain (4.1, 4.3, 9.5, 10.3, 11.4, 12.3).

Test setup is local and deterministic: the Live_Client HTTP layer is exercised against
mocked `fetch`; no backend service is required to run the suite.
