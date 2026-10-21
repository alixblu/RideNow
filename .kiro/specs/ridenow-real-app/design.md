# Design Document

## Overview

This feature makes RideNow a real application by adding the backend read/lifecycle
endpoints the product flows need and reworking the frontend from endpoint-shaped screens
into real flows wired to the live services. It spans four Spring Boot services and the
React/TypeScript frontend.

Design posture:

- **Backend**: small, conventional additions per service — a repository query, a thin
  service method, a thin controller method, and a shared per-service `PageResponse` DTO.
  No schema changes; all reads use existing columns (verified against the entities and the
  DBML). Each service keeps its own conventions (Java 25, Spring Boot 4.1.1, Maven wrapper,
  package layout, `@RestControllerAdvice` error handling with the shared `ApiErrorResponse`
  body) and its data ownership (scalar cross-service IDs, no joins across services).
- **Frontend**: realign the per-domain `Service_Client` contracts to the real DTOs,
  implement Live clients for every operation, flip the per-domain defaults to `live`, and
  restructure screens into a rider journey, a driver roster, and an admin directory. The
  `http`/`config` request-layer boundary and the live-vs-mock abstraction are unchanged;
  only contracts, client implementations, screens, and config defaults change.

Key grounded facts driving the design:

- `TripService.createTrip` creates a trip already in **SEARCHING**, so the rider journey's
  real first state is SEARCHING and progression to DRIVER_ASSIGNED happens when a driver
  calls the existing accept endpoint. The client reflects this by polling `getTrip`; there
  is no server auto-advance and none is added.
- The `Trip` entity guards transitions with methods (`acceptBy`); cancellation will follow
  the same pattern with a new `cancel(...)` method.
- trip-service lacks a 400 validation handler; this feature adds one for cross-service
  consistency.

## Backend design

### Shared shape: PageResponse

Each list endpoint returns a uniform wrapper. It is defined **per service** (no shared
cross-service module, per AGENTS.md) as a generic record in that service's `dto.response`
package:

```java
public record PageResponse<T>(List<T> items, long total, int limit, int offset) {}
```

Pagination rules (applied identically in every list service method):

- `limit`: default 20 (`DEFAULT_LIMIT`), clamped to max 100 (`MAX_LIMIT`).
- `offset`: default 0.
- Negative `limit` or `offset` → 400 (bean-validation on the controller params via
  `@Min(0)`, surfaced by each service's existing `MethodArgumentNotValidException`/
  `ConstraintViolationException` handling; trip-service gains the 400 handler in this work).
- Sorting: `createdAt` descending for users and drivers; `requestedAt` descending for trips.
- `total` is the full matching count (`repository.count()` or a filtered `countBy…`), not
  the page size.

Controllers pass a `PageRequest.of(offset / limit-aware page, limit, Sort…)`. Because the
API is offset/limit rather than page-number based, each service computes the page window
explicitly: fetch with a `Pageable` built from a derived page index when `offset` is a
multiple of `limit`, or use a repository query that applies `limit`/`offset` directly. To
keep it simple and correct for arbitrary offsets, each service uses a Spring Data
`Pageable` created via a small helper that maps (`offset`,`limit`) to a `PageRequest`
using `offset`-based slicing (`PageRequest.of(offset / limit, limit, sort)` is avoided when
offset is not a multiple of limit; instead the service queries an ordered slice and applies
the window, or uses `limit`/`offset` through a derived query). The chosen mechanism per
service is a repository method returning an ordered `List` plus a `count`, with the window
applied through `Pageable` where offset is a multiple of limit and through an explicit
ordered query otherwise. Implementations should prefer the simplest approach that passes
the tests; the observable contract is the `PageResponse` and the ordering/clamping rules
above.

> Implementation note: the straightforward, test-backed approach is a repository method
> `Page<T> findAll(Pageable)` / `findByX(…, Pageable)` with `Pageable` =
> `PageRequest.of(offset / limit, limit, sort)` and the controller requiring `offset` to be
> a multiple of `limit` is NOT imposed on the client. To support arbitrary offsets without
> a native query, each service defines a repository query returning an ordered `List` and
> the service sublists the `[offset, offset+limit)` window while deriving `total` from a
> `count`. This keeps behavior obvious and fully unit-testable with H2/mocks. Favor
> clarity over cleverness here.

### user-service — GET /api/users

- `UserRepository`: add `List<User> findAllByOrderByCreatedAtDesc()` (or
  `findAllByOrderByCreatedAtDesc(Pageable)`), plus `count()` from `JpaRepository`.
- `UserService`: add `PageResponse<UserResponse> listUsers(int limit, int offset)` that
  clamps/defaults, reads the ordered users, maps to `UserResponse`, and returns the window
  with `total = userRepository.count()`.
- `UserController`: add `@GetMapping` on `/api/users` with
  `@RequestParam(defaultValue="20") @Min(0) int limit` and
  `@RequestParam(defaultValue="0") @Min(0) int offset`.
- Enable `@Validated` on the controller (or rely on the existing validation handling) so
  negative params produce a 400 in `ApiErrorResponse` shape.

### driver-service — GET /api/drivers

- `DriverRepository`: add `List<Driver> findAllByOrderByCreatedAtDesc()` and
  `List<Driver> findByStatusOrderByCreatedAtDesc(DriverStatus status)`, plus
  `long countByStatus(DriverStatus status)`.
- `DriverService`: add
  `PageResponse<DriverResponse> listDrivers(int limit, int offset, DriverStatus statusOrNull)`
  applying the same clamping/window and selecting the filtered or unfiltered query; `total`
  is `count()` or `countByStatus(...)` accordingly.
- `DriverController`: add `@GetMapping("/drivers")` with `limit`, `offset`, and optional
  `@RequestParam(required=false) DriverStatus status`. An invalid enum value yields Spring's
  400 → mapped by the existing handler to `ApiErrorResponse`.

### trip-service — GET /api/trips, POST /api/trips/{id}/cancel, 400 handler

- `TripRepository`: add ordered finders:
  `findAllByOrderByRequestedAtDesc()`,
  `findByPassengerIdOrderByRequestedAtDesc(UUID passengerId)`,
  `findByStatusOrderByRequestedAtDesc(TripStatus status)`,
  `findByPassengerIdAndStatusOrderByRequestedAtDesc(UUID passengerId, TripStatus status)`,
  and matching `countBy…` methods for `total`.
- `TripService`:
  - `PageResponse<TripResponse> listTrips(UUID passengerIdOrNull, TripStatus statusOrNull, int limit, int offset)`
    that selects the right finder based on which filters are present, applies the window,
    and maps via the existing `toResponse`.
  - `TripResponse cancelTrip(UUID tripId, String reason)` that loads the trip (404 if
    missing) and calls a new guarded entity method `trip.cancel(reason, Instant.now())`.
- `Trip` entity: add
  ```java
  public void cancel(String reason, Instant now) {
      if (this.status == TripStatus.COMPLETED || this.status == TripStatus.CANCELLED) {
          throw new TripNotCancellableException(this.id, this.status);
      }
      this.status = TripStatus.CANCELLED;
      this.cancellationReason = reason;
      this.cancelledAt = now;
      this.updatedAt = now;
  }
  ```
- New `TripNotCancellableException` (mirrors `TripNotAcceptableException`) mapped to 409 in
  the trip-service `GlobalExceptionHandler`.
- `TripController`: add `@GetMapping("/trips")` (params `passengerId?`, `status?`, `limit`,
  `offset`) and `@PostMapping("/trips/{id}/cancel")` returning `TripResponse`. The cancel
  reason may be a fixed server-side default (e.g. "Cancelled by rider") or an optional body;
  default to a constant to avoid a new request DTO unless a reason is needed.
- Add `@ExceptionHandler(MethodArgumentNotValidException.class)` to the trip-service
  `GlobalExceptionHandler` returning 400 in `ApiErrorResponse` shape, consistent with the
  other services (first field error message), without disturbing the existing handlers.

### payment-service — GET /api/payments?tripId=

- `PaymentRepository`: add `Optional<Payment> findByTripId(UUID tripId)` (the DBML makes
  `payments.trip_id` unique, so at most one).
- `PaymentService`: add `PaymentResponse getPaymentForTrip(UUID tripId)` that returns the
  mapped payment or throws `ResourceNotFoundException` (→ 404).
- `PaymentController`: add a `@GetMapping` on the base `/api/payments` with
  `@RequestParam UUID tripId`. Because the base path already has `GET /api/payments/{id}`,
  the collection-level `GET /api/payments?tripId=` does not collide (different mapping: no
  path variable, required query param). A missing/invalid `tripId` yields 400 via the
  existing validation handling.

### Error-shape consistency

All four services already return `ApiErrorResponse { timestamp, status, error, message,
path }`. The only gap is trip-service's missing 400 handler, addressed above. No error
contract changes elsewhere.

## Frontend design

### Config and origins

- `config/pathPrefixMap.ts`: add origins for trip-service and payment-service and the
  trip-offers prefix:
  - `/api/drivers`, `/api/vehicles` → `http://localhost:8080`
  - `/api/users` → `http://localhost:8081`
  - `/api/trips`, `/api/trip-offers` → `http://localhost:8082`
  - `/api/payments` → `http://localhost:8083`
- `config/appConfig.ts`: default every domain to `live` (driver, vehicle, user, trip,
  matching, payment, notification). Note: `matching` and `notification` have no backend;
  their Live clients either call endpoints that exist (none yet) or the domains remain
  mock-selected in `.env` for local use. Since there is no matching/notification service,
  those two domains keep a mock implementation but the documented default is still the
  per-domain flag; `.env.example` will set trip/payment/driver/vehicle/user to `live` and
  leave matching/notification on `mock` with a comment that no service backs them yet.
- `.env.example`: document the full prefix→origin map and the per-domain modes.

> Honesty constraint: `matching` and `notification` have no implemented backend service.
> This feature does NOT fake them as live. They stay on `mock` in `.env.example` with a
> clear comment; everything else goes `live`. The rider "matching" experience is realized
> through the trip's own status progression (SEARCHING → DRIVER_ASSIGNED via the real trip
> endpoints), not a separate matching service.

### Domain contracts realigned to real DTOs

- **trip** (`domain/trip/contract.ts`): `TripResponse` becomes the full real shape —
  `id, passengerId, driverId|null, vehicleId|null, rideType, pickupLat, pickupLng,
  pickupAddress|null, destinationLat, destinationLng, destinationAddress|null, status,
  estimatedFare|null, finalFare|null, cancellationReason|null, version, requestedAt,
  acceptedAt|null, arrivedAt|null, startedAt|null, completedAt|null, cancelledAt|null,
  createdAt, updatedAt`. `CreateTripRequest` = `{ passengerId, rideType, pickupLat,
  pickupLng, destinationLat, destinationLng }`. `TripServiceClient` gains
  `listTrips(params)`, `acceptTrip(id, driverId)`, `cancelTrip(id)`, keeps
  `requestTrip`, `getTrip`.
- **payment** (`domain/payment/contract.ts`): `PaymentResponse` gains `idempotencyKey`,
  `paidAt|null`, `failedAt|null`; `PaymentMethod` = `"CASH" | "SIMULATED_CARD" | "PAYPAL"`.
  `CreatePaymentRequest` = `{ tripId, amount, currency, method, idempotencyKey }`.
  `PaymentServiceClient` gains `getPaymentForTrip(tripId)` and keeps `getPayment(id)` /
  `createPayment(req)`.
- **driver** (`domain/driver/contract.ts`): add `listDrivers({ limit?, offset?, status? })`
  returning a page; keep existing operations. `CreateDriverRequest.userId` is a UUID string.
- **user** (`domain/user/contract.ts`): add `listUsers({ limit?, offset? })`.
- A shared `Page<T>` type (`{ items: T[]; total: number; limit: number; offset: number }`)
  in `shared/` used by the list methods.

### Live clients

Each Live client maps new operations to real routes via the existing `httpRequest`:

- `listUsers` → `GET /api/users?limit&offset`
- `listDrivers` → `GET /api/drivers?limit&offset&status?`
- `listTrips` → `GET /api/trips?passengerId?&status?&limit&offset`
- `cancelTrip` → `POST /api/trips/{id}/cancel`
- `acceptTrip` → `POST /api/trips/{id}/accept?driverId=`
- `getPaymentForTrip` → `GET /api/payments?tripId=`

Mock clients implement the same methods over their in-memory stores (lists filter/paginate
the store) so offline mode still works.

### Screens

**Rider journey** (`apps/rider/`): replace the tabbed Trip/Matching/Payment/Notifications
layout with a single stateful journey component plus a "Your rides" list:

- A "Where to?" step with named pickup/destination fields backed by a small set of preset
  locations (each preset carries lat/lng); advanced users can still reveal numeric inputs,
  but the primary UI is named places. Submitting creates the trip.
- After creation, the journey shows the live status starting at SEARCHING and polls
  `getTrip` on an interval (e.g. 3s) while the trip is non-terminal, using TanStack Query's
  `refetchInterval`. When status reaches DRIVER_ASSIGNED+, it shows the assigned driver/
  vehicle ids carried on the trip.
- A Cancel action (visible for Cancellable_Status) calls `cancelTrip` and reflects CANCELLED.
- A fare panel loads `getPaymentForTrip(tripId)`; shows amount/currency/method/status and
  the failure reason on FAILED; shows a pending/empty state when no payment exists (404 is
  treated as "no payment yet", not an error banner).
- "Your rides" lists `listTrips({ passengerId: currentRiderId })`; selecting a ride resumes
  the journey view for it (this is the only "open by id" path and it is selection-driven,
  not typed).

**Driver roster** (`apps/driver/`): the primary surface becomes a driver list from
`listDrivers`; opening a driver shows profile + vehicles + status toggle. A separate
"Available rides" panel lists `listTrips({ status: "SEARCHING" })` and lets the opened
driver accept one via `acceptTrip(tripId, openedDriverId)`; a 409 shows "already taken" and
refreshes the list. Registration (create driver / add vehicle) moves to a secondary action.

**Admin directory** (`apps/admin/`): the primary surface becomes a user list from
`listUsers`; opening a user shows the full detail. Create user is a secondary action. No
update/delete surfaces.

### Loading, errors, accessibility, visual language

- Keep the in-button spinner (`Button loading`) on every create/accept/cancel/status action,
  and skeletons/loading indicators for lists and the journey.
- Keep the warm editorial dark-first theme and the existing shared UI kit.
- Preserve all accessibility hooks tests rely on (area nav label, in-area nav labels,
  identity switcher region + controls, identity-prompt `role="status"`, not-found
  `role="alert"` + area links, labelled form controls). Where new list/detail markup
  replaces old forms, add clear `aria-label`s and update the affected tests to match while
  preserving intent.

## Testing strategy

- **Backend (per service)**: a focused test per new endpoint. Service-level unit tests for
  list clamping/ordering/filtering and the cancel guard (cancel from a non-terminal status
  succeeds; cancel from COMPLETED/CANCELLED → 409; cancel of a missing trip → 404). A
  web-slice (`@WebMvcTest`) test where it validates the HTTP boundary (query-param binding,
  400 on negative/invalid params, 404 for payment-by-trip miss). Run `mvnw test` per service.
- **Frontend**: keep Vitest green. Update the existing driver/admin/rider screen tests to
  the new flows (list → open; journey states) while preserving what they verify; keep the
  live-vs-mock property/contract tests by exercising the Mock clients' new methods. Run
  `pnpm build` (tsc) + `pnpm test` twice for stability.
- **End-to-end smoke** (manual/scripted, services running): create a user → create a driver
  for that user → rider requests a ride (SEARCHING) → driver accepts (DRIVER_ASSIGNED
  appears via polling) → create/get payment for the trip → cancel a different SEARCHING
  trip → confirm 409 when accepting an already-taken trip.

## Sequencing

Backend first (each service independently shippable and testable), then frontend contracts/
clients, then screen reworks, then verification:

1. user-service list → 2. driver-service list → 3. trip-service list + cancel + 400 handler
→ 4. payment-service by-trip → 5. frontend contracts + live clients + config defaults →
6. rider journey → 7. driver roster + accept → 8. admin directory → 9. full verification.
