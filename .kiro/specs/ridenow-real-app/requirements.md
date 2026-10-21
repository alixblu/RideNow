# Requirements Document

## Introduction

RideNow currently presents an "API-tester" UI: screens are shaped like endpoints
(type-an-ID lookups, side-by-side create/get tabs, raw latitude/longitude inputs) and
most rider flows run against in-memory mock clients. This feature turns RideNow into a
real application in two coordinated parts:

1. **Backend**: add the missing read/collection and lifecycle endpoints the real flows
   need — paginated list endpoints for users, drivers, and trips; a trip cancel
   endpoint; a payment-by-trip lookup; and (for consistency) a validation error handler
   in trip-service. No database schema change is expected: every column these endpoints
   read already exists per the DBML source of truth.

2. **Frontend**: realign the per-domain Service_Client contracts to the real backend
   DTOs, implement live HTTP clients for every operation (including the new list/cancel/
   by-trip endpoints), default every domain to **live** against the real services, and
   restructure the screens from endpoint-shaped forms into real product flows: a rider
   ride journey, a driver roster, and an admin user directory.

Ground truth that shapes these requirements (verified against the code):

- A trip is created directly in status **SEARCHING** (not REQUESTED): `TripService.createTrip`
  constructs a `Trip` whose constructor sets `SEARCHING`. The honest rider progression is
  therefore SEARCHING → (a driver accepts via the existing accept endpoint) →
  DRIVER_ASSIGNED, surfaced on the client by polling `getTrip`. There is no server-side
  auto-advance timer and this feature does not add one.
- trip-service exposes create, accept (`POST /api/trips/{id}/accept?driverId=`, the
  optimistic-lock "exactly one winner" operation), get-trip, and get-trip-offer. It has
  **no** cancel endpoint, **no** list endpoint, and **no** `MethodArgumentNotValidException`
  handler (a `@Valid` failure currently returns Spring's default 400 body, not the shared
  `ApiErrorResponse`).
- No service exposes a collection/page endpoint today; the only collection-returning
  method is driver-service `GET /api/drivers/{driverId}/vehicles` (scoped to one driver).
- Deferred platform capabilities (Redis, SQS, EventBridge, WebSockets, Saga, live driver
  tracking) are explicitly out of scope and are not introduced.

## Glossary

- **Page_Response**: A uniform list response wrapper each list endpoint returns, with
  fields `items` (the page of records), `total` (total matching records), `limit`, and
  `offset`.
- **Default_Limit**: The page size used when a list request omits `limit` (20).
- **Max_Limit**: The maximum accepted page size; a larger requested `limit` is clamped to
  this value (100).
- **Rider_Journey**: The single stateful rider screen that moves a ride through its real
  lifecycle (request → searching → driver assigned → …) without the user typing identifiers.
- **Driver_Roster**: The driver-area screen that lists drivers from the drivers list
  endpoint and opens one by selection.
- **Admin_Directory**: The admin-area screen that lists users from the users list endpoint
  and opens one by selection.
- **Service_Client**: The frontend per-domain client abstraction with interchangeable
  Live (real HTTP) and Mock (in-memory) implementations selected by configuration.
- **Trip_Status**: REQUESTED, SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS,
  COMPLETED, CANCELLED.
- **Payment_Status**: PENDING, PROCESSING, PAID, FAILED.
- **Cancellable_Status**: Any Trip_Status except COMPLETED and CANCELLED.

## Requirements

### Requirement 1: Paginated users list (user-service)

**User Story:** As an admin, I want to browse user accounts in a list, so that I can open
a record without knowing its identifier in advance.

#### Acceptance Criteria

1. THE user-service SHALL expose `GET /api/users` accepting optional `limit` and `offset`
   query parameters and returning a Page_Response of the existing `UserResponse` shape.
2. WHEN `limit` is omitted, THE user-service SHALL use the Default_Limit; WHEN `limit`
   exceeds the Max_Limit, THE user-service SHALL clamp it to the Max_Limit.
3. WHEN `offset` is omitted, THE user-service SHALL default it to 0; IF `offset` or `limit`
   is negative, THEN THE user-service SHALL reject the request with a 400 error in the
   shared `ApiErrorResponse` shape.
4. THE user-service SHALL order the list by `createdAt` descending (newest first).
5. THE Page_Response SHALL report `total` as the count of all user records, independent of
   the returned page window.
6. THE user-service SHALL NOT change the `users` database schema; the list reads only
   existing columns.

### Requirement 2: Paginated drivers list (driver-service)

**User Story:** As an admin or operator, I want to browse drivers, optionally filtered by
status, so that I can find and open a driver without typing an identifier.

#### Acceptance Criteria

1. THE driver-service SHALL expose `GET /api/drivers` accepting optional `limit`, `offset`,
   and `status` query parameters and returning a Page_Response of `DriverResponse`.
2. WHERE a `status` parameter is supplied, THE driver-service SHALL return only drivers
   whose status equals that value; the only accepted values are ACTIVE and SUSPENDED.
3. IF `status` is supplied but is not a valid DriverStatus, THEN THE driver-service SHALL
   reject the request with a 400 error in the shared `ApiErrorResponse` shape.
4. THE driver-service SHALL apply the Default_Limit, Max_Limit, `offset` default, negative
   rejection, and `createdAt` descending order exactly as specified for the users list.
5. THE Page_Response `total` SHALL reflect the count of records matching the active filter
   (all drivers when no `status` is supplied; the filtered count otherwise).
6. THE driver-service SHALL NOT change the `drivers` schema.

### Requirement 3: Trips list by passenger and status (trip-service)

**User Story:** As a rider, I want to see my own rides; and as a driver, I want to see
rides that are currently searching for a driver, so that each role can act on real trips
without knowing trip identifiers.

#### Acceptance Criteria

1. THE trip-service SHALL expose `GET /api/trips` accepting optional `passengerId`,
   `status`, `limit`, and `offset` query parameters and returning a Page_Response of
   `TripResponse`.
2. WHERE `passengerId` is supplied, THE trip-service SHALL return only trips whose
   `passengerId` equals that value.
3. WHERE `status` is supplied, THE trip-service SHALL return only trips whose status equals
   that value (e.g. SEARCHING for driver-facing discovery); IF `status` is not a valid
   Trip_Status, THEN THE trip-service SHALL reject the request with a 400 error.
4. WHERE both `passengerId` and `status` are supplied, THE trip-service SHALL return only
   trips matching both.
5. THE trip-service SHALL apply the Default_Limit, Max_Limit, `offset` default, and negative
   rejection as specified for the other lists, and SHALL order trips by `requestedAt`
   descending.
6. THE trip-service SHALL NOT change the `trips` schema.

### Requirement 4: Cancel a trip (trip-service)

**User Story:** As a rider, I want to cancel a ride that has not finished, so that I can
abandon a request or an in-progress trip.

#### Acceptance Criteria

1. THE trip-service SHALL expose `POST /api/trips/{id}/cancel` that transitions the trip to
   CANCELLED and returns the updated `TripResponse`.
2. WHEN a trip is cancelled, THE trip-service SHALL set the status to CANCELLED, set
   `cancelledAt` to the cancellation time, set a `cancellationReason`, and update
   `updatedAt`.
3. THE trip-service SHALL allow cancellation only from a Cancellable_Status; IF the trip is
   already COMPLETED or CANCELLED, THEN THE trip-service SHALL reject the request with a 409
   error in the shared `ApiErrorResponse` shape and leave the trip unchanged.
4. IF the trip id does not exist, THEN THE trip-service SHALL return a 404 error.
5. THE cancel transition SHALL be implemented as a guarded method on the Trip entity
   (mirroring the existing `acceptBy` guard style), not as ad-hoc setters in the service.

### Requirement 5: Consistent validation errors in trip-service

**User Story:** As a client developer, I want trip-service validation failures to use the
same error shape as the other services, so that the frontend can handle errors uniformly.

#### Acceptance Criteria

1. THE trip-service SHALL handle `MethodArgumentNotValidException` and return a 400 error in
   the shared `ApiErrorResponse` shape (`timestamp`, `status`, `error`, `message`, `path`),
   consistent with user-service, driver-service, and payment-service.
2. THE added handler SHALL NOT alter the behavior of the existing trip-service exception
   handlers (404 not-found, 409 not-acceptable, 409 optimistic-lock, 409 data-integrity,
   500 catch-all).

### Requirement 6: Payment lookup by trip (payment-service)

**User Story:** As a rider, I want to see the payment for a specific ride, so that the fare
view can load a trip's payment without knowing the payment's own identifier.

#### Acceptance Criteria

1. THE payment-service SHALL expose `GET /api/payments` accepting a `tripId` query parameter
   and returning the `PaymentResponse` for that trip.
2. IF no payment exists for the supplied `tripId`, THEN THE payment-service SHALL return a
   404 error in the shared `ApiErrorResponse` shape.
3. IF `tripId` is absent or not a valid UUID, THEN THE payment-service SHALL reject the
   request with a 400 error.
4. THE payment-service SHALL NOT change the `payments` schema and SHALL rely on the existing
   one-payment-per-trip relationship.

### Requirement 7: Backend testing and conventions

**User Story:** As a maintainer, I want each new endpoint covered by a focused test and
built to the repository's conventions, so that the additions are trustworthy and consistent.

#### Acceptance Criteria

1. THE implementation SHALL add or update a focused test per changed service (service-level
   and/or web-slice) covering the new endpoint's success path and its key error paths
   (validation/clamping, not-found, and — for cancel — the terminal-status guard).
2. THE implementation SHALL preserve each service's Java version, Spring Boot version,
   Maven wrapper, package naming, and dependency conventions, and SHALL follow AGENTS.md
   (thin controllers, DTOs at boundaries, constructor injection, Jakarta validation, each
   service owning its data, scalar cross-service IDs, no cross-service joins).
3. THE implementation SHALL build and pass tests per changed service before that service is
   considered complete.
4. THE implementation SHALL NOT introduce Redis, SQS, EventBridge, WebSockets, Saga, or live
   driver tracking.

### Requirement 8: Frontend contracts realigned to real DTOs

**User Story:** As a frontend developer, I want the domain client contracts to match the
real backend DTOs exactly, so that live calls deserialize correctly and screens render
real data.

#### Acceptance Criteria

1. THE Frontend SHALL realign the trip domain types to the real `TripResponse` (including
   `pickupAddress`, `destinationAddress`, `version`, and the full set of lifecycle
   timestamps `acceptedAt`/`arrivedAt`/`startedAt`/`completedAt`/`cancelledAt`), and SHALL
   model `CreateTripRequest` with exactly the fields the endpoint accepts (passengerId,
   rideType, pickup/destination lat/lng).
2. THE Frontend SHALL realign the payment domain types to the real `PaymentResponse`
   (including `idempotencyKey`, `paidAt`, `failedAt`) and the `PaymentMethod` set
   CASH, SIMULATED_CARD, PAYPAL, and SHALL model `CreatePaymentRequest` with
   tripId, amount, currency, method, and idempotencyKey.
3. THE Frontend SHALL keep the driver and user domain types aligned to their real DTOs and
   add the new list operations (`listDrivers`, `listUsers`, `listTrips`), the trip
   `cancelTrip`, and the payment `getPaymentForTrip` to the respective Service_Client
   contracts.
4. THE Frontend SHALL implement the Live_Client for every Service_Client operation,
   including the new list/cancel/by-trip endpoints, mapping each to its real HTTP route,
   query parameters, and Page_Response shape.
5. THE Frontend SHALL keep a Mock_Client implementation of every contract as an opt-in
   offline fallback, selected by the existing per-domain configuration flag.

### Requirement 9: Frontend defaults to live services

**User Story:** As a user running the full system, I want the app to talk to the real
services by default, so that what I see reflects real backend state.

#### Acceptance Criteria

1. THE Frontend SHALL default every domain client (driver, vehicle, user, trip, matching,
   payment, notification) to `live` mode.
2. THE Frontend SHALL route each path prefix to its service origin in the local fallback:
   `/api/drivers` and `/api/vehicles` → driver-service (8080), `/api/users` → user-service
   (8081), `/api/trips` and `/api/trip-offers` → trip-service (8082), `/api/payments` →
   payment-service (8083).
3. THE Frontend `.env.example` SHALL document every domain defaulting to `live` and the full
   path-prefix-to-origin mapping including trip and payment services.
4. WHERE a single gateway `API_Base_URL` is configured, THE Frontend SHALL continue to send
   all requests to that origin with the documented path preserved.

### Requirement 10: Rider ride journey (flow, not endpoints)

**User Story:** As a rider, I want to request a ride and watch it progress on one screen,
so that I experience a ride rather than a set of ID lookups.

#### Acceptance Criteria

1. THE Rider_Journey SHALL let a rider start a ride by entering pickup and destination as
   named location fields (with selectable presets) rather than raw latitude/longitude
   boxes, while still submitting valid coordinates to the trip endpoint.
2. WHEN a rider submits a ride request, THE Rider_Journey SHALL create the trip via the trip
   Service_Client and then present the trip's live status, beginning at SEARCHING, without
   requiring the rider to type the trip identifier anywhere.
3. WHILE a trip is active and not in a terminal status, THE Rider_Journey SHALL periodically
   re-read the trip via the trip Service_Client so that a status change (e.g. a driver
   accepting) appears without a manual reload.
4. WHEN a trip reaches DRIVER_ASSIGNED or later, THE Rider_Journey SHALL display the assigned
   driver/vehicle information carried on the trip.
5. THE Rider_Journey SHALL let a rider cancel a ride in a Cancellable_Status via the cancel
   endpoint, and SHALL reflect the resulting CANCELLED status.
6. THE Rider_Journey SHALL show a "your rides" list sourced from `GET /api/trips?passengerId=`
   for the current rider identity, and SHALL let the rider open one to resume viewing it.
7. THE Rider_Journey SHALL present a fare view for a trip sourced from
   `GET /api/payments?tripId=`, rendering amount, currency, method, and Payment_Status, and
   the failure reason when the status is FAILED; WHERE no payment exists yet, it SHALL show
   an appropriate empty/pending state rather than an error.
8. THE Rider_Journey SHALL NOT require the rider to paste a trip identifier on the primary
   path; any resume-by-id affordance is secondary.

### Requirement 11: Driver roster and real accept

**User Story:** As a driver user, I want to browse drivers and act on rides that need a
driver, so that the driver area reflects real operational data and the accept flow is real.

#### Acceptance Criteria

1. THE Driver_Roster SHALL list drivers from `GET /api/drivers` and let the user open a
   driver by selection rather than by typing a driver identifier.
2. WHEN a driver is opened, THE Frontend SHALL display that driver's profile and vehicles
   (via the existing per-driver vehicles endpoint) and allow changing the driver's status.
3. THE Driver area SHALL present rides available to accept, sourced from
   `GET /api/trips?status=SEARCHING`, and SHALL let the opened driver accept one via the real
   `POST /api/trips/{id}/accept?driverId=` endpoint.
4. WHEN an accept attempt loses the race (409 from the optimistic-lock/guard), THE Frontend
   SHALL surface a clear "already taken" message and refresh the available-rides list.
5. THE Frontend SHALL keep driver and vehicle registration available as secondary actions,
   not as the primary browse surface.

### Requirement 12: Admin user directory

**User Story:** As an admin, I want a directory of users I can browse and open, so that the
admin area is a real management surface rather than create/get forms.

#### Acceptance Criteria

1. THE Admin_Directory SHALL list users from `GET /api/users` and let the admin open a user
   by selection.
2. WHEN a user is opened, THE Frontend SHALL display the full `UserResponse` detail.
3. THE Frontend SHALL keep user creation available as a secondary action.
4. THE Admin area SHALL confine itself to the capabilities the user-service exposes
   (create, get, and the new list); it SHALL NOT present update or delete surfaces.

### Requirement 13: Preserve the established frontend quality bar

**User Story:** As a maintainer, I want the rework to keep the app building, tested,
accessible, and visually consistent, so that going live and restructuring does not regress
quality.

#### Acceptance Criteria

1. THE Frontend SHALL keep `pnpm build` type-clean and `pnpm test` green; WHERE a
   restructured screen changes wording or markup a test asserts, THE test SHALL be updated
   to match while preserving the behavior it verifies.
2. THE Frontend SHALL preserve the accessibility hooks existing tests and users rely on:
   the area nav labelled "Application areas" with active indication, the rider/driver/admin
   in-area navs, the dev identity switcher region labelled "Development identity switcher"
   with "Role"/"Identifier"/"Set identity" controls, the identity-prompt `role="status"`
   message matching "set your … identity", the not-found `role="alert"` view with links to
   each area, and labelled form controls.
3. THE Frontend SHALL keep the in-request loading affordance (in-button spinner/disabled
   state) on every create/accept/cancel/status action.
4. THE Frontend SHALL keep the warm editorial visual language (dark-first with the light
   toggle) already established.
5. THE Frontend SHALL NOT change the `http`/`config` request-layer boundary design or the
   live-vs-mock Service_Client abstraction; the rework is flow, screens, contracts, and
   client implementations only.
