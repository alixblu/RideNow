# Plan: inbox notifications, SSE live location, hardening, frontend

Status: all tasks done (uncommitted). Task 8 decision: `vehicleType` = the vehicle picked with `vehicleId` on `POST /online`, else the newest active vehicle; with none, going online is refused (409). Work through the tasks in order. **Do not commit**; all changes stay
uncommitted for review, and other people's staged changes are left alone.

## Context (verified current state)

- **Services:** Spring Boot 4.1.1 / Java 25 / Maven wrapper, package `cloudnative.microservices.<name>`.
  - user-service 8081, driver-service 8080, trip-service 8082, payment-service 8083,
    notification-worker 8084, matching-service 8085, realtime-gateway 8086.
  - Frontend: React 18 + Vite + TanStack Query + Tailwind in `frontend/`.
  - Follow `AGENTS.md`: layered packages, constructor injection, DTOs at the boundary, DBML
    first, no cross-service DB access, small changes, build and test each service after changing it.
- **Async flow (built):**
  - EventBridge bus `ridenow-local-events` -> one SQS queue + DLQ per consumer:
    - matching: `trip.requested`
    - payment: `trip.completed`, `trip.cancelled`
    - notifications: every `ridenow.*` event
  - LocalStack: `localstack/init/01-messaging.sh`; `localstack/smoke-test.sh` exists but has never been run.
  - IaC: `iac/stacks` 01-07 (`cfn-lint` clean) and `iac/k8s` 20-26 + 30.
- **Payment:** sync authorize on `POST /trips` (strict, 402/503), then async capture/release.
  - Compensation `trip.cancelled` carries no `passengerId`.
- **notification-worker:**
  - Has `RecipientResolver` and `NotificationSender` (`RedisNotificationSender`, `LoggingNotificationSender`).
  - Ledger `processed_notifications`.
  - No user-readable inbox.
- **realtime-gateway:**
  - STOMP at `/ws`: `WebSocketConfig`, `InboundGuardInterceptor`, `StompClientChannel`, `Destinations`,
    `NotificationRelay`, `SessionRegistry`, `RedisSubscriberConfig`, `GatewayProperties`.
  - Readiness and liveness probes are split.
- **driver-service:** `POST /api/drivers/{id}/location` does two things:
  - writes the Redis hash `ridenow:driver:live:{id}` (TTL 5m);
  - publishes `LocationUpdate(driverId, lat, lng)` on `ridenow:driver:locations`.

  **Nobody subscribes.** matching's GEO index is only filled by a manual
  `POST /api/matching/positions`, which needs `vehicleType`.
- **Gaps found:**
  - Malformed JSON returns 500 everywhere: no `HttpMessageNotReadableException` handler in any service.
  - The driver -> user `RestClient` has no timeout.
  - driver-service and matching-service have no Redis TLS setting.
  - `iac/k8s/21-driver-service.yaml` has no Redis env at all.
  - Testcontainers 1.21.4 can't find Docker Engine 29.
  - `README.md` and `iac/README.md` still link to `localfile/`.
- **Frontend:**
  - `CreateTripRequest` lacks `paymentMethod`, so live mode returns 400.
  - `domain/notification` is mock-only, shape `{id, recipientId, message, createdAt}`.
  - `pathPrefixMap` maps `/api/notifications` to null.
  - The driver app has a roster and can accept `SEARCHING` trips, nothing more.
  - No map library.
  - Pattern: mock and live clients with conformance tests (vitest, fast-check).

## Decisions

- **Notifications:** a durable inbox table in notification-worker; the frontend polls `GET /api/notifications?since=`. Nothing is pushed.
- **Live location:**
  - Only the customer opens a connection, over **SSE**, while the trip is `DRIVER_ASSIGNED` / `DRIVER_ARRIVED` / `IN_PROGRESS`.
  - It carries the driver's position only.
  - The driver keeps posting over HTTP.
  - STOMP/WebSocket is removed.
- **Map:** Leaflet + OpenStreetMap tiles.
  - Road snapping via OSRM: `match` for real GPS (display only), `route` for the driver's simulated drive.
  - Behind a `RoadSnapper` interface (`NoopSnapper`, `OsrmSnapper`), configured by `VITE_OSRM_URL`. Empty = off, and the simulation uses a straight line.
  - The public OSRM demo server is dev-only (check its usage policy). Self-hosting is documented, not built. Server-side map matching is documented as the production alternative.
- **Driver location source:** browser Geolocation + a "simulate drive" toggle. If permission is denied, show a message and offer simulation.
- **Out of scope:** authentication (later; keep it documented as a gap), chat, mobile/web push, SNS, an AWS deploy, load tests.

## Tasks

- [x] **Task 1: Docs and DBML**
  - Objective: record the design before any code changes.
  - Guidance: new `docs/REALTIME.md` containing:
    - Flow diagram:
      - EventBridge -> SQS -> notification-worker -> inbox table, read by frontend polling;
      - driver POST -> driver-service -> `ridenow:driver:locations`, read by the gateway (SSE to the customer) and by matching.
    - Sequence diagram:
      - accept -> pairing keys;
      - the customer draws the REST snapshot, then opens `EventSource`;
      - `location` events about once a second;
      - trip end -> pairing deleted + `ridenow:tracking:ended` -> `event: trip-ended` -> close;
      - reconnect -> 410.
    - Stream-lifetime table by trip status.
    - Redis keys/channels and payload tables.
    - SSE client contract:
      - open only in tracking statuses, REST snapshot first;
      - events `location` and `trip-ended`;
      - 400/403/410 stop retries;
      - `: ping` every ~15s.
    - Smooth-marker guidance:
      - buffer points and render ~1s behind, interpolating with `requestAnimationFrame`;
      - order by `recordedAt` and drop out-of-order points;
      - jump straight there for moves over 500m; mark stale after 10s;
      - eased, shortest-turn heading;
      - pan only near the edge;
      - note the client/server clock offset.
    - Road snapping section:
      - OSRM `match` and `route`;
      - demo-server limits and self-hosting notes;
      - the display-only rule;
      - the server-side alternative.
  - Also:
    - Shorten `ARCHITECTURE.md` section 5 to link to `REALTIME.md`, and update its gaps list.
    - DBML: add a `notifications` table (id uuid pk, user_id, event_id, type, message, trip_id null,
      occurred_at null, created_at, read_at null; index (user_id, created_at/id); unique (event_id, user_id)).
    - `KNOWLEDGE.md`: STOMP rows -> SSE; add rows for inbox polling, OSRM snapping and the hardening items.
  - Demo: the docs describe the target design.

- [x] **Task 2: Fix Testcontainers on Docker Engine 29**
  - Objective: the existing Testcontainers suites run on this machine.
  - Guidance:
    - Diagnose with debug logging on one suite first.
    - Preferred: bump `testcontainers.version` in every pom to a release whose notes confirm Docker
      Engine 29 support. Verify; don't assume a version.
    - Fallback: pin the Docker API version through `docker-java.properties` / `~/.testcontainers.properties`,
      documented in the README.
    - Keep the same version everywhere.
  - Tests: these pass:
    - `EventBridgeToSqsIntegrationTest` (trip, payment);
    - `NotificationWorkerIntegrationTest`;
    - `MatchingPersistenceIntegrationTest` and `MatchingRedisGeoIntegrationTest`.
  - Demo: `./mvnw test` is green in those services with Docker running.

- [x] **Task 3: Malformed JSON -> 400 in every service**
  - Objective: a client's bad JSON never returns 500.
  - Guidance: add an `HttpMessageNotReadableException` handler returning 400.
    - Use the existing `ApiErrorResponse` shape with a generic message, no parser internals.
    - Add it to user, driver, trip, payment and matching. notification-worker gets it in Task 6.
  - Tests: one web-slice test per service, posting `{"broken":`.
  - Demo: `curl` with broken JSON gets 400 from each service.

- [x] **Task 4: Timeout on the driver -> user call**
  - Objective: a hung user-service can't tie up driver-service.
  - Guidance: mirror trip-service (`PaymentServiceProperties`, and `HttpClientConfig` with `JdkClientHttpRequestFactory`).
    - Add connect/read timeouts to `UserServiceProperties`: defaults 2s/3s, overridable by env.
    - A failure still maps to `UpstreamUnavailableException` (503).
  - Tests: a client test with `MockRestServiceServer`; a timeout maps to `UpstreamUnavailableException`.
  - Demo: with user-service stopped, creating a driver returns 503 within about 3s.

- [x] **Task 5: Redis TLS in driver-service and matching-service**
  - Objective: both can connect to ElastiCache, which has in-transit TLS.
  - Guidance:
    - Add `spring.data.redis.ssl.enabled: ${REDIS_SSL:false}` to both `application.yaml` files.
    - `iac/k8s/21-driver-service.yaml` (no Redis env today): add `REDIS_HOST` / `REDIS_PORT` / `REDIS_SSL=true`.
    - `24-matching-service.yaml`: add `REDIS_SSL=true`.
    - Update `guides/aws/07-later-elasticache-redis.md`, and the Redis TLS notes in `README.md` / `iac/README.md`.
  - Tests: both services' test suites pass with the default (false); the manifests parse.
  - Demo: the setting shows in each service's config.

- [x] **Task 6: Notification inbox (notification-worker)**
  - Objective: every notification becomes a durable, readable row.
  - Guidance:
    - A Flyway `V2` migration and a `Notification` entity matching the DBML.
    - An `InboxNotificationSender` replaces `RedisNotificationSender`.
      - Delete `RedisNotificationSender`, the delivery switch and the channel config.
      - The sender writes in the same transaction as the processed-event ledger.
    - API:
      - `GET /api/notifications?userId=&since=&limit=`: items after `since`, ascending, limit capped at 100;
      - `POST /api/notifications/{id}/read`.
    - Layered packages and validation, plus a `@RestControllerAdvice` that includes the malformed-JSON 400 handler.
    - Keep `RecipientResolver` and the message texts.
  - Tests:
    - service: one row per recipient; a duplicate event adds nothing; a failure rolls back the ledger;
    - web slice: `since`, `limit`, a bad UUID -> 400;
    - update the integration test.
  - Demo: after a trip, `GET` lists the messages, and `?since=` returns only newer ones.

- [x] **Task 7: Trip tracking pairing (notification-worker)**
  - Objective: tell the gateway who may watch whom, and when that ends.
  - Guidance:
    - On `driver.accepted`, with a 3h TTL:
      - `SET ridenow:tracking:trip:{tripId}` = {passengerId, driverId};
      - `SET ridenow:tracking:driver:{driverId}` = {tripId, passengerId}.
    - On `trip.completed` / `trip.cancelled`: `DEL` both keys and `PUBLISH ridenow:tracking:ended {tripId}`.
    - It runs inside the existing idempotent handler; `SET` and `DEL` are naturally idempotent.
  - Tests: per-event unit tests, including a cancel with no driver and the compensation event (no passengerId).
  - Demo: the keys appear and disappear across a trip, and the ended message is published.

- [x] **Task 8: driver-service location data**
  - Objective: positions carry what the stream and matching need.
  - Guidance:
    - Add `recordedAt` to `LocationUpdate` and to the `GET /api/drivers/{id}/live` response.
    - Add `vehicleType` to `LocationUpdate`. **First** inspect how driver-service knows a driver's
      active vehicle. If it's ambiguous, **stop and ask the user.**
    - Publish an offline update (for example `online=false`) from `goOffline`.
    - Additive fields only.
  - Tests: payload shape tests; an offline publish test.
  - Demo: `SUBSCRIBE ridenow:driver:locations` shows the new fields and the offline marker.

- [x] **Task 9: Driver -> matching position handoff**
  - Objective: async matching finds drivers who only post over HTTP.
  - Guidance: matching-service subscribes to `ridenow:driver:locations` with a `RedisMessageListenerContainer`.
    - It upserts through `DriverPositionService`, removes the driver on offline, and drops malformed updates.
    - The lossy channel is acceptable, because the latest position wins.
  - Tests: subscriber unit tests (upsert, remove, malformed).
  - Demo: a driver goes online and posts a location; a new trip gets an offer with no manual `/positions` call.

- [x] **Task 10: Gateway SSE replacing STOMP**
  - Objective: `GET /live/trips/{tripId}/location?userId=` streams positions to that trip's passenger only.
  - Guidance:
    - On open: an invalid UUID -> 400; no pairing -> 410; the userId isn't the passenger -> 403.
    - A per-pod registry of tripId -> `SseEmitter`s, capped at 3 per trip.
    - Location listener:
      - cached pairing lookup by driverId (~5s), throttled to 1 event per second per trip;
      - `event: location` with data {driverId, tripId, lat, lng, recordedAt} and **no id**.
    - Ended listener: send `event: trip-ended`, complete the emitters, evict the cache.
    - Stream hygiene:
      - `: ping` every 15s, a 30-minute timeout, a jittered `retry`;
      - headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`;
      - complete every emitter on shutdown.
    - Delete `WebSocketConfig`, `InboundGuardInterceptor`, `StompClientChannel`, `Destinations`,
      `NotificationRelay`, and the websocket and websocket-test dependencies.
    - Rework `SessionRegistry` into the emitter registry. Keep the probes and graceful shutdown. Update `GatewayProperties`.
  - Tests: a real-HTTP integration test with `ridenow.gateway.redis.enabled=false` and the listeners driven directly:
    - delivery to the paired passenger, and an unpaired driver's positions dropped;
    - 403 and 410;
    - `trip-ended` closing the stream;
    - the throttle and the heartbeat;
    - completion on shutdown;
    - the existing probe test.
  - Demo: `curl -N` shows positions during the trip and `trip-ended` at the end.

- [x] **Task 11: LocalStack integration tests for the payment and matching consumers**
  - Objective: prove queue -> consumer -> database end to end.
  - Guidance: Testcontainers Postgres + LocalStack, creating the bus, queue, DLQ and rule like the init script.
    - **payment:** seed an `AUTHORIZED` payment and put `trip.completed` on the bus, then await `PAID`.
      A duplicate leaves the payment unchanged, and a poison message reaches the DLQ.
    - **matching:** seed a position (Postgres finder) and put `trip.requested` on the bus, then await offers.
      A duplicate adds no second set of offers.
  - Demo: green runs. This needs Task 2.

- [x] **Task 12: Compose, IaC and docs wiring**
  - Objective: local and cloud match the new design.
  - Guidance:
    - Compose: notification-worker drops `RIDENOW_NOTIFICATIONS_DELIVERY` but keeps Redis for the pairing.
    - Kubernetes:
      - add a `Service` for notification-worker (8084);
      - ingress: add `/api/notifications` -> notification-worker; replace `/ws` with `/live` -> realtime-gateway; keep the 300s idle timeout;
      - update the comments and env in the 25 and 26 manifests.
    - Docs:
      - rewrite `realtime-gateway/README.md` as the SSE contract, linking to `docs/REALTIME.md`;
      - update `docs/SERVICES.md`, the root `README.md`, `guides/aws/00-deploy-runbook.md` and `guides/aws/08-later-sqs-eventbridge.md`;
      - fix the stale `localfile/` links in `README.md` and `iac/README.md`.
  - Tests: YAML parse of every manifest; `cfn-lint iac/stacks/*.yaml` (no stack changes expected); `docker compose config --quiet`.
  - Demo: manifests and docs reference only `/live` and `/api/notifications`.

- [x] **Task 13: Frontend contracts and clients**
  - Objective: the frontend matches the backend again.
  - Guidance:
    - Trips:
      - `CreateTripRequest.paymentMethod` (CASH / SIMULATED_CARD / PAYPAL), with a select in the booking form;
      - trip client methods `arriveTrip`, `startTrip`, `completeTrip`.
    - Payments: add the `AUTHORIZED` / `RELEASED` statuses to the enums and `StatusPill`.
    - Drivers: client methods `goOnline`, `goOffline`, `updateLocation`, `getLiveState`.
    - Notifications:
      - contract -> {id, userId, type, message, tripId, occurredAt, createdAt, readAt};
      - live client with `listSince(userId, sinceId?)` and `markRead(id)`.
    - `pathPrefixMap`: `/api/notifications` -> 8084, `/live` -> 8086.
    - Road snapping:
      - `VITE_OSRM_URL` in config (default empty);
      - a `RoadSnapper` interface with `NoopSnapper` and `OsrmSnapper`, covering `match` and `route`, with a timeout and a fallback to raw points.
    - Update the mocks and keep the conformance tests.
  - Tests: conformance and client tests; snapper tests with a mocked fetch (success, error/timeout fallback); `npm test` and `npm run build` pass.
  - Demo: requesting a ride works in live mode.

- [x] **Task 14: Frontend notification inbox**
  - Objective: in-app toasts and an inbox, through polling.
  - Guidance: a `useNotifications(userId)` hook on TanStack Query:
    - poll `?since=` every 3s (2s for drivers);
    - pause while the tab is hidden, refetch on focus, back off on errors;
    - a toast per new item, deduplicated by id;
    - a bell with an unread count, and an inbox list with mark-read, in both the rider and driver areas.
  - Tests: hook tests with fake timers (`since`, dedupe, paused while hidden); component tests.
  - Demo: trip events appear as toasts within about 3s and stay after a reload.

- [x] **Task 15: Frontend rider live map**
  - Objective: the rider watches the car move smoothly on Leaflet/OSM.
  - Guidance:
    - Add `leaflet` + `react-leaflet`, at versions compatible with React 18, and an OSM tile layer with attribution.
    - `useDriverLocationStream(trip)`:
      - opens an `EventSource` only in the tracking statuses, after drawing the REST snapshot;
      - closes on `trip-ended`, a terminal status, or unmount.
    - `createSmoothMarker` as described in `REALTIME.md`; use snapped points via `RoadSnapper` when configured.
    - Add pickup and destination markers, replacing the decorative panel.
  - Tests: smoothing-math unit tests with a fake clock; hook tests with a fake `EventSource` (open/close by status, `trip-ended`).
  - Demo: the car glides during a trip, and the stream closes at completion.

- [x] **Task 16: Frontend driver trip desk**
  - Objective: a driver can run a whole trip from the browser.
  - Guidance:
    - An online/offline toggle.
    - While online, send location every 1-2s:
      - from browser Geolocation;
      - or from a "simulate drive" toggle that follows the OSRM route pickup -> destination (a straight line if OSRM is unset).
    - Geolocation denied -> show a message and offer simulation.
    - Available rides (existing), plus an offer toast from the inbox.
    - Current-trip actions arrive / start / complete.
    - Stop sending on offline or unmount.
  - Tests: component tests for the toggle, sender start/stop with fake timers, and the action buttons per status.
  - Demo: one browser as driver, one as rider. The driver accepts, the rider sees the car move, and completion shows payment success in the inbox.

- [x] **Task 17: End-to-end verification**
  - Objective: prove it all on the full stack.
  - Guidance:
    - Run `docker compose up --build` and `localstack/smoke-test.sh`, then the Task 16 flow in two browsers.
    - Check:
      - another user gets 403, and a reconnect after the end gets 410;
      - broken JSON gets 400 on each service;
      - with user-service stopped, driver creation fails fast with 503;
      - after a gateway restart, the stream recovers while the trip is active.
    - Run all backend suites (including Testcontainers), `npm test` and `npm run build`.
    - Record the results in `ARCHITECTURE.md` section 8, replacing the STOMP-era rows.
    - Report honestly what couldn't be verified.
  - Demo: a documented run-through.

**Still out of scope:** authentication (later), chat, push/SNS, AWS deploy, load tests.
