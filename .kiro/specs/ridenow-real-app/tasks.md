# Implementation Plan: RideNow Real Application

## Overview

Backend-first, then frontend. Each backend service is independently buildable and testable
(`mvnw test`), follows AGENTS.md, and makes no schema change. The frontend then realigns
contracts to the real DTOs, implements live clients, defaults to live, and restructures the
screens into real flows — keeping `pnpm build` type-clean and `pnpm test` green.

Ground truth honored throughout: trips are created in SEARCHING (no server auto-advance;
the rider journey polls `getTrip`); the trip accept endpoint is the real
exactly-one-winner operation; `matching` and `notification` have no backend and stay on
mock.

## Tasks

- [ ] 1. user-service: paginated users list
  - [ ] 1.1 Add the list query + service + controller
    - `UserRepository`: add an ordered finder (`findAllByOrderByCreatedAtDesc`) returning a
      `List<User>`; reuse `count()` for total.
    - Add `PageResponse<T>` record to `dto/response`.
    - `UserService.listUsers(limit, offset)`: clamp limit to [0, 100] default 20, offset
      default 0, window the ordered list, map to `UserResponse`, total = `count()`.
    - `UserController`: `@GetMapping` on `/api/users` with `@Min(0)` `limit`/`offset`
      (defaults 20/0); ensure negative params yield a 400 `ApiErrorResponse`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.2_
  - [ ]* 1.2 Tests for the users list
    - Service test: default/clamped limit, offset window, createdAt-desc order, total count.
    - Web-slice test: 200 with page body; 400 on negative limit/offset.
    - _Requirements: 1.2, 1.3, 1.4, 7.1_
  - [ ] 1.3 Build + test user-service (`mvnw test`)
    - _Requirements: 7.3_

- [ ] 2. driver-service: paginated drivers list (optional status filter)
  - [ ] 2.1 Add the list query + service + controller
    - `DriverRepository`: `findAllByOrderByCreatedAtDesc`, `findByStatusOrderByCreatedAtDesc`,
      `countByStatus`.
    - Add `PageResponse<T>` record to driver-service `dto/response`.
    - `DriverService.listDrivers(limit, offset, statusOrNull)`: clamp/window; total via
      `count()` or `countByStatus`.
    - `DriverController`: `@GetMapping("/drivers")` with `limit`, `offset`, optional
      `status` (DriverStatus). Invalid enum → 400 via existing handler.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.2_
  - [ ]* 2.2 Tests for the drivers list
    - Service test: unfiltered + status-filtered results, clamping, order, filtered total.
    - Web-slice test: 200 page body; 400 on invalid status enum / negative params.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 7.1_
  - [ ] 2.3 Build + test driver-service (`mvnw test`)
    - _Requirements: 7.3_

- [ ] 3. trip-service: trips list, cancel, and 400 handler
  - [ ] 3.1 Add the 400 validation handler
    - Add `@ExceptionHandler(MethodArgumentNotValidException.class)` to the trip-service
      `GlobalExceptionHandler` returning 400 in `ApiErrorResponse` shape (first field error),
      leaving existing handlers unchanged.
    - _Requirements: 5.1, 5.2_
  - [ ] 3.2 Add the trips list query + service + controller
    - `TripRepository`: ordered finders by none/passengerId/status/both (requestedAt desc)
      and matching `countBy…`.
    - Add `PageResponse<T>` record to trip-service `dto/response`.
    - `TripService.listTrips(passengerIdOrNull, statusOrNull, limit, offset)`: select finder,
      clamp/window, map via existing `toResponse`.
    - `TripController`: `@GetMapping("/trips")` with `passengerId?`, `status?`, `limit`,
      `offset`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.2_
  - [ ] 3.3 Add trip cancel (guarded entity method + exception + service + controller)
    - `Trip.cancel(reason, now)`: guard against COMPLETED/CANCELLED (throw new
      `TripNotCancellableException`); set CANCELLED + cancelledAt + cancellationReason +
      updatedAt.
    - Map `TripNotCancellableException` → 409 in the `GlobalExceptionHandler`.
    - `TripService.cancelTrip(tripId, reason)`: load (404 if missing) + call `cancel`.
    - `TripController`: `@PostMapping("/trips/{id}/cancel")` → `TripResponse` (fixed default
      reason, no new request DTO).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.2_
  - [ ]* 3.4 Tests for list, cancel, and validation
    - Service tests: list filters/clamp/order; cancel from non-terminal succeeds; cancel
      from COMPLETED/CANCELLED → 409; cancel missing → 404.
    - Web-slice test: list 200 page body; 400 on invalid status/negative params (via the new
      handler); cancel 200 and 409 paths.
    - _Requirements: 3.3, 3.5, 4.3, 4.4, 5.1, 7.1_
  - [ ] 3.5 Build + test trip-service (`mvnw test`)
    - _Requirements: 7.3_

- [ ] 4. payment-service: payment lookup by trip
  - [ ] 4.1 Add find-by-trip query + service + controller
    - `PaymentRepository`: add `findByTripId(UUID)` → `Optional<Payment>`.
    - `PaymentService.getPaymentForTrip(tripId)`: return mapped payment or throw
      `ResourceNotFoundException` (→ 404).
    - `PaymentController`: `@GetMapping` on `/api/payments` with required `@RequestParam UUID
      tripId` (distinct from the existing `/{id}` mapping).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.2_
  - [ ]* 4.2 Tests for payment-by-trip
    - Service test: found → response; missing → 404.
    - Web-slice test: 200 for existing trip payment; 404 when none; 400 on missing/invalid
      tripId.
    - _Requirements: 6.1, 6.2, 6.3, 7.1_
  - [ ] 4.3 Build + test payment-service (`mvnw test`)
    - _Requirements: 7.3_

- [ ] 5. Frontend: contracts, live clients, config defaults
  - [ ] 5.1 Realign domain contracts/types to the real DTOs
    - Update trip, payment, driver, user contract types (full TripResponse incl. addresses/
      version/timestamps; CreateTripRequest minimal; PaymentResponse incl. idempotencyKey/
      paidAt/failedAt + PAYPAL; CreatePaymentRequest; driver userId UUID). Add a shared
      `Page<T>` type. Add `listTrips`/`cancelTrip`/`acceptTrip`, `getPaymentForTrip`,
      `listDrivers`, `listUsers` to the Service_Client interfaces.
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ] 5.2 Implement Live clients for all new operations
    - Map each new method to its real route/query/Page shape via `httpRequest`.
    - _Requirements: 8.4, 9.2_
  - [ ] 5.3 Implement Mock client methods (offline fallback)
    - Add list/cancel/accept/get-by-trip to the in-memory mocks so offline mode still works.
    - _Requirements: 8.5_
  - [ ] 5.4 Config defaults + path map + .env.example
    - `pathPrefixMap`: add trip (8082, incl. `/api/trip-offers`) and payment (8083) origins.
    - `appConfig`: default trip/payment/driver/vehicle/user to `live`; keep matching/
      notification on `mock` (no backend). Update `.env.example` to document all of it.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ]* 5.5 Contract/mock tests updated
    - Update the live-vs-mock contract/property tests to cover the new methods against the
      Mock clients; keep them green.
    - _Requirements: 8.5, 13.1_

- [ ] 6. Frontend: rider ride journey
  - [ ] 6.1 Build the stateful journey + "Your rides"
    - "Where to?" with preset named locations (carry lat/lng) → create trip; show live status
      from SEARCHING with `refetchInterval` polling of `getTrip` while non-terminal; show
      assigned driver/vehicle at DRIVER_ASSIGNED+; Cancel for cancellable statuses; fare
      panel via `getPaymentForTrip` (404 = pending/empty, not error); "Your rides" list via
      `listTrips({ passengerId })` with select-to-open. Keep the rider in-area nav label and
      the "set your identity" guard; remove ID typing from the happy path.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 13.3_
  - [ ]* 6.2 Rider journey tests
    - Update/author tests: journey renders SEARCHING after request; polling reflects a status
      change; cancel → CANCELLED; fare renders fields and FAILED reason; empty payment state;
      "Your rides" lists and opens. Preserve accessibility hooks.
    - _Requirements: 10.2, 10.3, 10.5, 10.7, 13.1, 13.2_

- [ ] 7. Frontend: driver roster + real accept
  - [ ] 7.1 Build the roster, driver detail, and available-rides accept
    - Primary surface = driver list (`listDrivers`) → open → profile + vehicles + status
      toggle. "Available rides" = `listTrips({ status: "SEARCHING" })`; accept via
      `acceptTrip(tripId, openedDriverId)`; 409 → "already taken" + refresh. Registration
      secondary. Keep the driver in-area nav label and field labels.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 13.3_
  - [ ]* 7.2 Driver roster/accept tests
    - List → open; status change; accept success; accept 409 "already taken" + refresh.
    - _Requirements: 11.1, 11.3, 11.4, 13.1_

- [ ] 8. Frontend: admin user directory
  - [ ] 8.1 Build the directory + detail; create secondary
    - Primary surface = user list (`listUsers`) → open → full detail; create as secondary; no
      update/delete. Keep the admin in-area nav label and "Create user"/"Look up user"
      affordances where retained.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.3_
  - [ ]* 8.2 Admin directory tests
    - List → open → detail; create path still works.
    - _Requirements: 12.1, 12.2, 13.1_

- [ ] 9. Final verification
  - Frontend: `pnpm build` type-clean + `pnpm test` green twice; reconcile any tests whose
    wording/markup changed (preserving intent); confirm accessibility hooks and the warm
    editorial theme intact.
  - Backend: confirm all four services built and tested green.
  - End-to-end smoke (services running): user → driver → rider requests ride (SEARCHING) →
    driver accepts (DRIVER_ASSIGNED via polling) → payment create/get-by-trip → cancel a
    second SEARCHING trip → 409 on accepting an already-taken trip.
  - _Requirements: 7.3, 7.4, 13.1, 13.4, 13.5_

## Notes

- Tasks marked `*` are tests; the plan is written so each service and each frontend layer is
  verifiable on its own.
- No schema changes: all reads use existing columns per the DBML.
- Deferred platform capabilities (Redis/SQS/EventBridge/WebSockets/Saga/live-tracking) are
  out of scope; `matching` and `notification` remain mock (no backend).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "3.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "4.3", "3.3"] },
    { "id": 3, "tasks": ["3.4"] },
    { "id": 4, "tasks": ["3.5"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 7, "tasks": ["5.5", "6.1", "7.1", "8.1"] },
    { "id": 8, "tasks": ["6.2", "7.2", "8.2"] },
    { "id": 9, "tasks": ["9"] }
  ]
}
```
