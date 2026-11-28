# RideNow - Services Structure

A map of every deployable unit in the RideNow cluster: what it owns, how it is laid out,
what it talks to, and where it runs. For the reasoning behind these boundaries see
`ARCHITECTURE.md`; for persistent fields see `database/ridenow.dbml`.

Base package for all Java services: `cloudnative.microservices.<name>`
(user-service uses `cloudnative.microservices.ridenow`).

---

## 1. Service inventory

| Service | Port | Database | Redis | AWS messaging | Public via ALB |
|---------|------|----------|-------|---------------|----------------|
| `user-service` | 8081 | `user-db` (Postgres) | - | - | yes `/api/users` |
| `driver-service` | 8080 | `driver-db` (Postgres) | live state, Pub/Sub and stream publish, profile cache | - | yes `/api/drivers` |
| `trip-service` | 8082 | `trip-db` (Postgres) | - | publishes to SNS | yes `/api/trips` |
| `payment-service` | 8083 | `payment-db` (Postgres) | - | publishes to SNS, consumes SQS payment queue | yes `/api/payments` |
| `notification-worker` | 8084 | `notification-db` (Postgres) | tracking pairing keys, publishes trip-ended | consumes SQS notifications queue | yes `/api/notifications` |
| `matching-service` | 8085 | `matching-db` (Postgres) | GEO index, reads the driver-locations stream (consumer group) | consumes SQS matching queue, publishes to SNS | no |
| `realtime-gateway` | 8086 | none | subscribes to driver locations and trip-ended, reads pairing keys | - | SSE `/live` |
| `frontend` | - | - | - | - | static SPA (React + Vite) |

Ports are the local `docker-compose.yml` values. Open the live position stream with
`curl -N "http://localhost:8086/live/trips/{tripId}/location?userId={passengerId}"`
(see `docs/REALTIME.md`).

---

## 2. Responsibilities and API surface

### user-service
Rider/user accounts and user-owned profile data.
- `POST /api/users`, `GET /api/users`, `GET /api/users/{id}`

### driver-service
Driver accounts, vehicles, and live driver state.
- `GET|POST /api/drivers`, `GET /api/drivers/{id}`
- `GET|POST /api/drivers/{driverId}/vehicles`, `GET /api/vehicles/{id}`
- `PATCH /api/drivers/{driverId}/status`
- Live (Valkey is the primary store): `POST /api/drivers/{driverId}/online|offline|location`,
  `GET /api/drivers/{driverId}/live`. `online` takes an optional `{"vehicleId"}`; without it the
  newest active vehicle is used, and with none it returns 409. Positions are published on
  `ridenow:driver:locations` (the gateway) and appended to the stream `ridenow:stream:driver-locations`
  (matching-service, capped at about 10,000 entries), with `recordedAt` and `vehicleType`; going offline
  publishes `online:false`.
- Sync dependency: calls user-service to validate the user when creating a driver.

### trip-service
Trip lifecycle state machine and trip offers. Accept-ride uses `@Version` optimistic
locking (exactly one winner).
- `POST /api/trips`, `GET /api/trips`, `GET /api/trips/{id}`
- `POST /api/trips/{id}/accept|arrive|start|complete|cancel`
- `GET /api/trip-offers/{id}`
- Sync dependency: authorizes the fare with payment-service on `POST /trips` (strict, no
  hold means no trip). A timeout or connection failure is retried (3 attempts, 500ms
  apart, `SERVICES_PAYMENT_SERVICE_MAX_ATTEMPTS` / `_RETRY_BACKOFF`), because a payment
  pod that has just started can miss the 3s read timeout on its first authorize. The
  trip id is the idempotency key, so a retry never places a second hold; a retry that
  gets 409 reads the payment with `GET /api/payments?tripId=`. HTTP errors are not retried.
- Publishes: `trip.requested`, `driver.accepted`, `driver.arrived`, `trip.started`,
  `trip.completed`, `trip.cancelled`.

### payment-service
Payment records and explicit payment states, behind a `PaymentGateway` interface
(`SimulatedPaymentGateway` today).
- `POST /api/payments` (authorize, called by trip-service), `GET /api/payments/{id}`,
  `GET /api/payments?tripId=`
- Consumes: `trip.completed` (capture), `trip.cancelled` (release).
- Publishes: `payment.succeeded`, `payment.failed`.

### matching-service
Driver-to-trip matching decisions and offers.
- `POST /api/matching/match`, `GET /api/matching/trips/{tripId}/offers`
- `/api/matching/positions` ingests driver positions over HTTP. Positions from driver-service arrive
  on the `ridenow:stream:driver-locations` stream, read through the consumer group `matching`
  (acknowledged after they are applied, retried, dead-lettered after 5 deliveries). Reports that are not
  newer than the stored one are ignored.
- `NearbyDriverFinder` has two implementations: `PostgresNearbyDriverFinder` and
  `RedisGeoNearbyDriverFinder` (selected by `MATCHING_FINDER`, `redis` in compose).
- Consumes: `trip.requested`. Publishes: `match.offered`.

### notification-worker
SQS consumer plus the inbox API.
- Consumes every event (its subscription has no filter) and deduplicates through the `ProcessedNotification`
  idempotency ledger. `RecipientResolver` picks who to tell from the ids in the event
  (the passenger for most events, the driver for `match.offered`, both for a cancellation
  with an assigned driver). `InboxNotificationSender` writes one `notifications` row per
  recipient in the same transaction as the ledger row.
- `GET /api/notifications?userId=&since=&limit=` returns items after the `since` id,
  oldest first, at most 100. `POST /api/notifications/{id}/read` marks one read.
- `TrackingPairingService` sets `ridenow:tracking:trip:{tripId}` and
  `ridenow:tracking:driver:{driverId}` on `driver.accepted` (3h TTL), and on trip end
  deletes them and publishes `ridenow:tracking:ended`.
### realtime-gateway
Streams the driver's position to the trip's passenger over SSE. No database, no business API.
- `GET /live/trips/{tripId}/location?userId=`: 400 for a bad UUID, 410 with no pairing,
  403 for anyone but the passenger. Events `location` and `trip-ended`; `: ping` every 15s.
- `LocationRelay` and `TripEndedRelay` handle the two Redis Pub/Sub channels; `StreamRegistry`
  holds this pod's streams (at most 3 per trip). Contract: `realtime-gateway/README.md`.
### frontend
React + Vite + Tailwind SPA with `apps/`, `domain/`, `http/`, `identity/`, `shared/`,
`config/` under `src/`.

---

## 3. Internal layout of a Spring Boot service

```text
<service>/
  pom.xml, mvnw, mvnw.cmd, .mvn/
  Dockerfile, .dockerignore, docker-compose.yml   # per-service DB only
  src/main/java/<root-package>/
    <Name>Application.java
    controller/   dto/request  dto/response   service/   repository/   entity/
    exception/    config/
    client/       # outbound HTTP (driver, trip)
    event/        # DomainEvent publisher + SQS consumers (trip, payment, matching)
    gateway/      # payment gateway abstraction (payment)
    live/ cache/  # Valkey live state, location publish and cache-aside (driver)
  src/main/resources/
    application.yaml
    db/migration/V1__init_schema.sql          # Flyway schema
    db/migration/R__seed_demo_data.sql        # repeatable seed (not in matching/notification)
```

Service-specific packages beyond the standard layers:

| Service | Extra packages |
|---------|----------------|
| driver-service | `cache`, `client`, `config`, `live` |
| trip-service | `client`, `config`, `event` |
| payment-service | `config`, `event`, `gateway` |
| matching-service | `config`, `event` |
| notification-worker | `config`, `dto` |
| realtime-gateway | `config`, `controller`, `dto`, `service` (no `entity`/`repository`) |

---

## 4. Communication map

### Synchronous HTTP (need the answer now)

```text
driver-service  --->  user-service      validate user on driver creation
trip-service    --->  payment-service   authorize fare on trip request
```

### Asynchronous events (SNS topic -> SQS queue -> consumer)

Topic: `ridenow-local-events`. Each queue has a DLQ (`maxReceiveCount` 5). Each queue
is fed by one subscription with raw message delivery, so the SQS body is the event
JSON itself (no SNS envelope). Subscriptions filter on the body's top-level `type`
(`FilterPolicyScope=MessageBody`), so filtering needs no message attributes. Publishers add
only the trace context attributes (`traceparent`, `X-Amzn-Trace-Id`); see section 4.1.

| Queue | Subscription filter (`type`) | Consumer |
|-------|------------------------------|----------|
| `ridenow-local-matching` | `trip.requested` | matching-service |
| `ridenow-local-payment` | `trip.completed`, `trip.cancelled` | payment-service |
| `ridenow-local-notifications` | none (every event) | notification-worker |

```text
trip-service --trip.requested--> [matching queue] --> matching-service --match.offered--> topic
trip-service --trip.completed/cancelled--> [payment queue] --> payment-service --payment.*--> topic
all events --> [notifications queue] --> notification-worker --> inbox table <-- apps poll
                                              |  pairing keys, trip-ended (Redis)
                                              v
driver-service --ridenow:driver:locations (Pub/Sub)--> realtime-gateway --SSE--> passenger app
                 \--ridenow:stream:driver-locations (Stream)--> matching-service (GEO index)
```

### Valkey roles (ElastiCache for Valkey; Redis protocol, so the clients and `REDIS_*` variables are unchanged)
1. Live driver state and location (driver-service, primary store, not in Postgres).
2. GEO index for nearby-driver search (matching-service).
3. Pub/Sub for live tracking and the trip-ended signal to the gateway.
4. Stream of driver locations, read by matching-service through a consumer group.
5. Cache-aside for the driver profile (driver-service).

### 4.1 Tracing

All seven services run the OpenTelemetry Java agent (`JAVA_TOOL_OPTIONS=-javaagent:/opt/otel/opentelemetry-javaagent.jar`)
and send OTLP over gRPC to the ADOT Collector at `http://adot-collector.ridenow.svc.cluster.local:4317`
(manifest `iac/k8s/15-adot-collector.yaml`). The Collector exports to X-Ray.

| Variable | Value |
|----------|-------|
| `OTEL_SERVICE_NAME` | the service name, for example `trip-service` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://adot-collector.ridenow.svc.cluster.local:4317` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` |
| `OTEL_PROPAGATORS` | `xray,tracecontext,baggage` |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio`, `1.0` (lower it to cut cost) |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `none` |
| `OTEL_INSTRUMENTATION_SPRING_SCHEDULING_ENABLED` | `false` (queue pollers do not start traces) |
| `OTEL_INSTRUMENTATION_JDBC_STATEMENT_SANITIZER_ENABLED` | `true` |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=<env>` |

Every HTTP response carries an `X-Trace-Id` header (`1-<8 hex>-<24 hex>`, exposed through CORS).
Log lines carry `trace_id=` and `span_id=`. Paste the header value into the X-Ray console to open
the trace. Without the agent the tracing code does nothing.

---

## 5. Data ownership

Database-per-service. No shared tables, no cross-service joins; foreign identifiers are
stored as scalar UUIDs.

| Service | Owns |
|---------|------|
| user-service | users |
| driver-service | drivers, vehicles (live location lives in Redis) |
| trip-service | trips, trip offers |
| payment-service | payments |
| matching-service | driver positions, trip offers (matching view) |
| notification-worker | processed-notification ledger, notification inbox |
| realtime-gateway | none |

Ratings ownership is intentionally undecided; no ratings service or tables exist.

---

## 6. Repository layout outside the services

```text
ridenow/
  docker-compose.yml        # whole local system: 6 Postgres, Valkey, LocalStack, 7 services
  .env.example              # compose defaults (DB creds, AWS region, topic ARN)
  localstack/               # init/01-messaging.sh (topic, queues, DLQs, subscriptions), smoke-test.sh
  iac/
    stacks/                 # CloudFormation 01 iam, 02 network, 03 ecr, 04 data,
                            #   05 messaging, 06 eks-cluster, 07 eks-addons
    k8s/                    # namespace, external-secrets, one manifest per service, ingress
    params/                 # prod
    scripts/                # deploy.sh, teardown.sh, cleanup-cluster.sh
  docs/                     # ARCHITECTURE, KNOWLEDGE, SERVICES, proposal, DBML, stage guides
  guides/cloudformation/    # CLI step-by-step AWS guides (+ guides/scripts/push-to-ecr.sh)
  frontend/                 # SPA
```

Kubernetes manifests exist for user, driver, trip, payment, matching,
notification-worker and realtime-gateway (`iac/k8s/20-26`). The ingress routes
`/api/notifications` to notification-worker and `/live` to realtime-gateway.

---

## 7. Environments

| Stage | Mechanism |
|-------|-----------|
| Single service | `mvnw spring-boot:run` + the service's own `docker-compose.yml` (DB only) |
| Whole system | root `docker compose up --build` with LocalStack and Valkey |
| Cloud | EKS Fargate, RDS (Multi-AZ, per service), ElastiCache for Valkey, SNS, SQS |

Local to cloud is a config swap (endpoints, credentials via env or Secrets Manager); the
service boundaries do not change.
