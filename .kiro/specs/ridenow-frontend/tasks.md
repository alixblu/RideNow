# Implementation Plan: RideNow Frontend

## Overview

This plan builds the `frontend/` React + TypeScript + Vite app incrementally and test-first.
It follows the design's project structure and sequencing:

1. **Shell / infra / config / http / identity / client-factory** — the foundation every
   domain depends on.
2. **LIVE domains** — driver, vehicle (driver-service), and user (user-service), wired to
   real endpoints through `httpClient` with mocked `fetch` in tests.
3. **STUBBED domains** — trip, matching, payment, notification as `Mock_Client`
   implementations behind documented contracts, ready to become drop-in live.
4. **Cross-cutting UI** — loading, client-error, and service-unavailable + retry handling.

Each prompt builds on prior ones and ends by wiring new pieces into the shell/routing so no
orphaned code is left behind. Every task references its design correctness properties
(P1–P18) and the requirement clauses it satisfies. All tests run under Vitest (+ fast-check)
with mocked `fetch`; no backend is required.

## Tasks

- [x] 1. Scaffold the `frontend/` app (React + TypeScript + Vite)
  - Create the top-level `frontend/` app with `index.html`, `package.json`, `tsconfig.json`
    (strict), and `vite.config.ts`.
  - Add dependencies: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`;
    dev deps `vite`, `typescript`, `vitest`, `@testing-library/react`,
    `@testing-library/jest-dom`, `jsdom`, `fast-check`.
  - Configure Vitest (jsdom environment, setup file) and add `dev`, `build`, `test` scripts.
  - Add `.env.example` documenting `VITE_API_BASE_URL` and per-domain `VITE_CLIENT_*` flags;
    gitignore `.env`.
  - Create `src/main.tsx` that mounts the router + `QueryClient` providers (minimal stub so
    the app builds and runs standalone).
  - _Requirements: 1.5_

- [x] 2. Configuration module (appConfig + Path_Prefix_Map)
  - [x] 2.1 Implement `config/appConfig.ts` and `config/pathPrefixMap.ts`
    - `appConfig.ts`: read `VITE_API_BASE_URL` once at startup (null => fallback) and
      per-domain `live`/`mock` modes (live domains default `live`, stubbed default `mock`).
    - `pathPrefixMap.ts`: map `/api/drivers` and `/api/vehicles` → driver-service origin,
      `/api/users` → user-service origin, and null placeholders for
      `/api/trips`, `/api/matching`, `/api/payments`, `/api/notifications`.
    - _Requirements: 3.1, 3.3, 3.4_

  - [x] 2.2 Write unit tests for config parsing and defaults
    - Assert base URL is read once, per-domain mode defaults, and placeholder entries exist.
    - _Requirements: 3.1, 3.4_

- [x] 3. HTTP request layer (URL resolution, error type, fetch wrapper)
  - [x] 3.1 Implement `http/ApiError.ts` and `http/resolveUrl.ts`
    - `ApiError`: normalized client-facing error carrying status, short code, curated
      message only (factories `notFound`, `conflict`, `validation`, `unavailable`).
    - `resolveUrl(path, config)`: gateway mode preserves path on `apiBaseUrl`; fallback mode
      selects the longest matching prefix; matched-but-null origin throws
      `ApiError.unavailable`.
    - _Requirements: 3.2, 3.3, 3.5_

  - [x] 3.2 Write property test for URL resolution
    - **Property 10: URL resolution follows active configuration**
    - **Validates: Requirements 3.2, 3.3, 3.5**

  - [x] 3.3 Implement `http/httpClient.ts` (fetch wrapper)
    - Resolve URL via `resolveUrl`, attach acting principal from `Current_Identity` when a
      request requires one, parse backend `ApiErrorResponse`, and normalize every failure
      into a sanitized `ApiError` (map 404/409/400/503 and network failures).
    - _Requirements: 2.3, 13.2, 13.3_

  - [x] 3.4 Write property test for error sanitization
    - **Property 12: Client errors are sanitized**
    - **Validates: Requirements 5.5, 6.6, 13.2**

- [x] 4. Identity module (replaceable boundary + dev switcher)
  - [x] 4.1 Implement identity types, context, hook, and dev provider
    - `identity/types.ts` (`Role`, `Identity`, `IdentityApi`), `IdentityContext.tsx`,
      `useCurrentIdentity.ts` (stable contract screens consume), and `DevIdentityProvider.tsx`
      (in-memory state + switcher UI). No tokens/credentials/login — set/get only.
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [x] 4.2 Write property test for identity set/get round-trip
    - **Property 3: Identity set/get round-trip**
    - **Validates: Requirements 2.2, 2.5**

  - [x] 4.3 Write property test for acting principal equals Current_Identity
    - **Property 4: Acting principal equals Current_Identity** (exercise httpClient principal
      attachment with mocked fetch).
    - **Validates: Requirements 2.3**

- [x] 5. Generic client factory and shared enums
  - [x] 5.1 Implement `domain/clientFactory.ts` and `shared/enums.ts`
    - `resolveClient(mode, live, mock)` selecting implementation by per-domain config.
    - `enums.ts`: `DriverStatus`, `VehicleType`, `TripStatus`, `PaymentStatus` plus enum
      validation helpers used by forms/selectors.
    - _Requirements: 4.2, 6.3, 7.1_

  - [x] 5.2 Write property test for enum validation
    - **Property 6: Only allowed enum values validate**
    - **Validates: Requirements 6.3, 7.1**

- [x] 6. App shell, routing, and shared UI primitives
  - [x] 6.1 Implement shared UI, layout, and `App.tsx` shell with routing
    - `shared/ui/` (`Loading`, `ErrorBanner`, `Unavailable` + Retry, `NotFound`, `EmptyState`,
      identity-prompt guard) and `shared/layout/` nav chrome with active-area indicator.
    - `App.tsx` + `routes.tsx`: nested `rider/*`, `driver/*`, `admin/*` subtrees, index
      redirect, and catch-all `*` → `NotFound`; mount `DevIdentityProvider` above the router.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4_

  - [x] 6.2 Write property test for identity preserved across navigation
    - **Property 1: Identity preserved across navigation**
    - **Validates: Requirements 1.3**

  - [x] 6.3 Write property test for unknown routes resolve to not-found
    - **Property 2: Unknown routes resolve to not-found**
    - **Validates: Requirements 1.4**

  - [x] 6.4 Write unit tests for shell navigation, active indicator, and identity prompt
    - Verify three areas render, active area is indicated, and role-specific screens show the
      "set your identity" prompt when no identity is set.
    - _Requirements: 1.1, 1.2, 2.4_

- [x] 7. Checkpoint - foundation
  - Ensure all tests pass and the app builds/runs standalone; ask the user if questions arise.
  - _Requirements: 1.5_

- [x] 8. LIVE driver domain (contract, live + mock clients)
  - [x] 8.1 Implement `domain/driver/contract.ts` and `liveClient.ts`
    - `DriverServiceClient` interface + `CreateDriverRequest`/`DriverResponse` types mirroring
      the Java records; `liveClient` maps operations to driver-service endpoints
      (`POST /api/drivers`, `GET /api/drivers/{id}`, `PATCH .../status`) via `httpClient`.
    - _Requirements: 4.1, 5.1, 5.3, 7.2_

  - [x] 8.2 Implement `domain/driver/mockClient.ts` and `index.ts`
    - In-memory `Mock_Client` returning values satisfying `DriverResponse`; `index.ts`
      `resolveDriverClient(config)` wired to the factory.
    - _Requirements: 4.2, 4.4_

  - [x] 8.3 Write property test for mock driver responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (driver domain).
    - **Validates: Requirements 4.4, 4.5**

- [x] 9. LIVE vehicle domain (driver-service owns vehicles)
  - [x] 9.1 Implement `domain/vehicle/contract.ts`, `liveClient.ts`, `mockClient.ts`, `index.ts`
    - `CreateVehicleRequest`/`VehicleResponse` types; live client maps
      `POST /api/drivers/{driverId}/vehicles`, `GET /api/drivers/{driverId}/vehicles`,
      `GET /api/vehicles/{id}`; mock client + factory entry.
    - _Requirements: 4.1, 6.1, 6.4, 6.5_

  - [x] 9.2 Write property test for mock vehicle responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (vehicle domain).
    - **Validates: Requirements 4.4, 4.5**

- [x] 10. LIVE user domain (user-service create/get only)
  - [x] 10.1 Implement `domain/user/contract.ts`, `liveClient.ts`, `mockClient.ts`, `index.ts`
    - `UserServiceClient` confined to `createUser` (`POST /api/users`) and `getUser`
      (`GET /api/users/{id}`); `CreateUserRequest`/`UserResponse` types; mock + factory entry.
    - _Requirements: 4.1, 8.1, 8.3, 8.5_

  - [x] 10.2 Write property test for mock user responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (user domain).
    - **Validates: Requirements 4.4, 4.5**

- [ ] 11. Driver_App screens (profile, vehicles, status)
  - [x] 11.1 Implement driver create/detail and vehicle create/list/detail screens
    - Build `apps/driver/` screens using TanStack Query over the driver/vehicle clients:
      create-driver form, driver detail view (all `DriverResponse` fields), add-vehicle form
      (Vehicle_Type restricted to enum), vehicle list and vehicle detail, status-change
      control (ACTIVE/SUSPENDED). Client-side required-field validation blocks submission.
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2_

  - [x] 11.2 Write property test for driver detail renders all contract fields
    - **Property 7: Driver detail renders all contract fields**
    - **Validates: Requirements 5.3**

  - [x] 11.3 Write property test for complete vehicle rendering
    - **Property 8: Vehicle rendering is complete**
    - **Validates: Requirements 6.4, 6.5**

  - [ ] 11.4 Write property test for missing required fields block submission
    - **Property 5: Missing required fields block submission** (driver and vehicle forms).
    - **Validates: Requirements 5.2, 6.2, 8.2**

  - [x] 11.5 Write unit tests for driver/vehicle not-found and conflict handling
    - Driver/vehicle not-found view (5.4, 7.3) and sanitized conflict messages (5.5, 6.6).
    - _Requirements: 5.4, 5.5, 6.6, 7.3_

- [x] 12. Admin_Console user screens
  - [x] 12.1 Implement user create and user detail screens
    - Build `apps/admin/` screens over the user client: create-user form with field-level
      validation, and user detail view rendering returned fields; confine surfaces to
      create/get only.
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [ ] 12.2 Write unit tests for user validation and not-found
    - Field-level validation messages (8.2) and user not-found view (8.4).
    - _Requirements: 8.2, 8.4_

- [ ] 13. Checkpoint - LIVE domains
  - Ensure all tests pass and LIVE screens work against mocked fetch; ask the user if
    questions arise.

- [x] 14. STUBBED trip domain (contract + mock client)
  - [x] 14.1 Implement `domain/trip/contract.ts`, `mockClient.ts`, `index.ts`
    - `TripServiceClient` (`requestTrip` → REQUESTED, `getTrip`, `cancelTrip` → CANCELLED)
      with request/response types drawn from the DBML (no live-location/real-time fields);
      in-memory mock store + factory entry behind the documented future contract.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 14.2 Write property test for new trip starts REQUESTED and echoes its request
    - **Property 13: New trip starts REQUESTED and echoes its request**
    - **Validates: Requirements 9.1**

  - [x] 14.3 Write property test for trip status always within the defined set
    - **Property 14: Trip status is always within the defined set**
    - **Validates: Requirements 9.2**

  - [x] 14.4 Write property test for trip read-back round-trip
    - **Property 15: Trip read-back round-trip**
    - **Validates: Requirements 9.3**

  - [x] 14.5 Write property test for cancelling an eligible trip yields CANCELLED
    - **Property 16: Cancelling an eligible trip yields CANCELLED**
    - **Validates: Requirements 9.4**

  - [x] 14.6 Write property test for mock trip responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (trip domain).
    - **Validates: Requirements 4.4, 4.5**

- [x] 15. STUBBED matching domain (contract + mock client)
  - [x] 15.1 Implement `domain/matching/contract.ts`, `mockClient.ts`, `index.ts`
    - `MatchingServiceClient.getMatchState(tripId)` transitioning SEARCHING →
      DRIVER_ASSIGNED with an assigned-driver summary; types + factory entry.
    - _Requirements: 10.2, 10.3_

  - [x] 15.2 Write property test for resolved match yields assigned driver and DRIVER_ASSIGNED
    - **Property 17: Resolved match yields an assigned driver and DRIVER_ASSIGNED**
    - **Validates: Requirements 10.2**

- [x] 16. STUBBED payment domain (contract + mock client)
  - [x] 16.1 Implement `domain/payment/contract.ts`, `mockClient.ts`, `index.ts`
    - `PaymentServiceClient.getPaymentForTrip(tripId)` returning amount/currency/method/
      Payment_Status; FAILED payments carry a non-empty failure reason; types + factory entry.
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 16.2 Write property test for payment status within set and failures carry a reason
    - **Property 18: Payment status within set, and failures carry a reason**
    - **Validates: Requirements 11.2, 11.3**

  - [x] 16.3 Write property test for mock payment responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (payment domain).
    - **Validates: Requirements 4.4, 4.5**

- [x] 17. STUBBED notification domain (contract + mock client)
  - [x] 17.1 Implement `domain/notification/contract.ts`, `mockClient.ts`, `index.ts`
    - `NotificationServiceClient.listForIdentity(identityId)` returning message + timestamp
      notifications; types + factory entry.
    - _Requirements: 12.1, 12.3_

  - [x] 17.2 Write property test for mock notification responses conform to the contract
    - **Property 11: Mock responses conform to the shared contract** (notification domain,
      covering the message/timestamp rendering shape).
    - **Validates: Requirements 4.4, 4.5, 12.1**

- [ ] 18. Rider_App screens (trip request/lifecycle, matching, payment, notifications)
  - [x] 18.1 Implement rider trip, matching, payment, and notifications screens
    - Build `apps/rider/` screens over the stubbed clients: trip request form (ride type
      restricted to enum, no live-location UI), trip lifecycle view showing Trip_Status from
      the defined set, cancel action, matching-in-progress view and assigned-driver summary,
      payment view (amount/currency/method/status + failure reason), and notifications view
      with empty-state. Screens render identically to live ones (no mock marker).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 10.1, 10.2, 11.1, 11.2, 11.3, 12.1, 12.2_

  - [ ] 18.2 Write property test for payment and notification views render all contract fields
    - **Property 9: Payment and notification views render all contract fields**
    - **Validates: Requirements 11.1, 12.1**

  - [ ] 18.3 Write unit tests for matching-in-progress, payment failure, and notifications empty-state
    - Matching-in-progress view (10.1), payment failure reason surfaced (11.3), and
      notifications empty-state (12.2).
    - _Requirements: 10.1, 11.3, 12.2_

- [ ] 19. Cross-cutting error / loading / unavailable UI wiring
  - [x] 19.1 Wire loading, client-error, and unavailable + retry handling across screens
    - Connect TanStack Query `isPending`/`isError` states to shared `Loading`, `ErrorBanner`,
      and `Unavailable` + Retry components so every LIVE and STUBBED screen shows a loading
      indicator while pending, a sanitized message on client error, and a retry action on
      service-unavailable (including null placeholder origins).
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 19.2 Write unit tests for loading indicator and unavailable + retry
    - Loading indicator appears while pending (13.1); unavailable message + retry re-runs the
      query (13.3).
    - _Requirements: 13.1, 13.3_

- [ ] 20. Smoke / structural checks
  - [ ] 20.1 Write structural smoke tests
    - Assert the app builds and runs standalone (1.5), user client exposes only create/get
      (8.5), no token/credential storage exists (2.6), trip screens reference no
      real-time/live-location modules (9.6), and each domain shares one interface across
      Live/Mock implementations (4.1, 4.3, 9.5, 10.3, 11.4, 12.3).
    - _Requirements: 1.5, 2.6, 4.1, 4.3, 8.5, 9.5, 9.6, 10.3, 11.4, 12.3_

- [ ] 21. Final checkpoint - full suite
  - Ensure all tests pass (Vitest + fast-check, mocked fetch, no backend) and the app builds;
    ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP.
- Each task references specific requirement clauses and, where applicable, the design
  correctness property it validates, for traceability.
- Property tests use fast-check (≥100 iterations) and are tagged
  `Feature: ridenow-frontend, Property {number}`.
- All tests run under Vitest against mocked `fetch`; no Spring Boot service is required.
- Checkpoints provide incremental validation at the end of the foundation, LIVE, and full
  phases.
- LIVE domains (driver, vehicle, user) also ship mock clients so screens work offline and so
  the Live/Mock swap is exercised; STUBBED domains are mock-only behind documented contracts
  that a future Live_Client can match without screen changes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "4.1", "5.1"] },
    { "id": 3, "tasks": ["3.4", "4.2", "4.3", "5.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "8.1", "9.1", "10.1", "14.1", "15.1", "16.1", "17.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.2", "10.2", "14.2", "14.3", "14.4", "14.5", "14.6", "15.2", "16.2", "16.3", "17.2"] },
    { "id": 6, "tasks": ["11.1", "12.1", "18.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "11.4", "11.5", "12.2", "18.2", "18.3", "19.1"] },
    { "id": 8, "tasks": ["19.2", "20.1"] }
  ]
}
```
