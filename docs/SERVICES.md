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
| `driver-service` | 8080 | `driver-db` (Postgres) | live state, GEO publish, Pub/Sub, profile cache | - | yes `/api/drivers` |
| `trip-service` | 8082 | `trip-db` (Postgres) | - | publishes to EventBridge | yes `/api/trips` |
| `payment-service` | 8083 | `payment-db` (Postgres) | - | publishes to EventBridge, consumes SQS payment queue | yes `/api/payments` |
| `notification-worker` | 8084 | `notification-db` (Postgres) | publishes to Pub/Sub | consumes SQS notifications queue | no |
| `matching-service` | 8085 | `matching-db` (Postgres) | GEO index | consumes SQS matching queue, publishes to EventBridge | no |
| `realtime-gateway` | 8086 | none | subscribes to Pub/Sub | - | WebSocket (STOMP) |
| `frontend` | - | - | - | - | static SPA (React + Vite) |

Ports are the local `docker-compose.yml` values. Connect a WebSocket client to
`ws://localhost:8086/ws` and subscribe to `/topic/users/{userId}`.

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
- Live (Redis is the primary store): `POST /api/drivers/{driverId}/online|offline|location`,
  `GET /api/drivers/{driverId}/live`
- Sync dependency: calls user-service to validate the user when creating a driver.

### trip-service
Trip lifecycle state machine and trip offers. Accept-ride uses `@Version` optimistic
locking (exactly one winner).
- `POST /api/trips`, `GET /api/trips`, `GET /api/trips/{id}`
- `POST /api/trips/{id}/accept|arrive|start|complete|cancel`
- `GET /api/trip-offers/{id}`
- Sync dependency: authorizes the fare with payment-service on `POST /trips` (strict, no
  hold means no trip).
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
- `/api/matching/positions` ingests driver positions.
- `NearbyDriverFinder` has two implementations: `PostgresNearbyDriverFinder` and
  `RedisGeoNearbyDriverFinder` (selected by `MATCHING_FINDER`, `redis` in compose).
- Consumes: `trip.requested`. Publishes: `match.offered`.

### notification-worker
Pure SQS consumer; no business HTTP API (health endpoint only).
- Consumes every `ridenow.*` event and deduplicates through the `ProcessedNotification`
  idempotency ledger. `RecipientResolver` picks who to tell from the ids in the event
  (the passenger for most events, the driver for `match.offered`, both for a cancellation
  with an assigned driver). It then sends through a `NotificationSender`:
  `RedisNotificationSender` (`RIDENOW_NOTIFICATIONS_DELIVERY=redis`, used in compose
  and EKS) publishes to Redis Pub/Sub for realtime-gateway, and the logging sender is the
  no-dependency default.

### realtime-gateway
Owns the WebSocket (STOMP) sessions. No database, no business API.
- Subscribes to Redis Pub/Sub and pushes messages to connected clients
  (`NotificationRelay`, `SessionRegistry`, `InboundGuardInterceptor`).

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
    live/ cache/  # Redis live state and cache-aside (driver)
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
| realtime-gateway | `channel`, `config`, `dto`, `service`, `websocket` (no `entity`/`repository`) |

---

## 4. Communication map

### Synchronous HTTP (need the answer now)

```text
driver-service  --->  user-service      validate user on driver creation
trip-service    --->  payment-service   authorize fare on trip request
```

### Asynchronous events (EventBridge bus -> SQS queue -> consumer)

Bus: `ridenow-local-events`. Each queue has a DLQ (`maxReceiveCount` 5).

| Queue | Rule matches | Consumer |
|-------|--------------|----------|
| `ridenow-local-matching` | `trip.requested` | matching-service |
| `ridenow-local-payment` | `trip.completed`, `trip.cancelled` | payment-service |
| `ridenow-local-notifications` | every `ridenow.*` event | notification-worker |

```text
trip-service --trip.requested--> [matching queue] --> matching-service --match.offered--> bus
trip-service --trip.completed/cancelled--> [payment queue] --> payment-service --payment.*--> bus
all events --> [notifications queue] --> notification-worker
                                              |  Redis Pub/Sub
                                              v
                                       realtime-gateway --WebSocket--> apps
```

### Redis roles
1. Live driver state and location (driver-service, primary store, not in Postgres).
2. GEO index for nearby-driver search (matching-service).
3. Pub/Sub for live tracking and notification relay.
4. Cache-aside for the driver profile (driver-service).

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
| notification-worker | processed-notification ledger |
| realtime-gateway | none |

Ratings ownership is intentionally undecided; no ratings service or tables exist.

---

## 6. Repository layout outside the services

```text
ridenow/
  docker-compose.yml        # whole local system: 6 Postgres, Redis, LocalStack, 7 services
  .env.example              # compose defaults (DB creds, AWS region, bus name)
  localstack/               # init/01-messaging.sh (bus, queues, DLQs, rules), smoke-test.sh
  iac/
    stacks/                 # CloudFormation 01 iam, 02 network, 03 ecr, 04 data,
                            #   05 messaging, 06 eks-cluster, 07 eks-addons
    k8s/                    # namespace, external-secrets, one manifest per service, ingress
    params/                 # dev / staging / prod
    scripts/                # deploy.sh, teardown.sh, cleanup-cluster.sh
  docs/                     # ARCHITECTURE, KNOWLEDGE, SERVICES, proposal, DBML, stage guides
  guides/aws/               # console-first AWS guides (+ guides/scripts/push-to-ecr.sh)
  frontend/                 # SPA
```

Kubernetes manifests exist for user, driver, trip, payment, matching,
notification-worker and realtime-gateway (`iac/k8s/20-26`). The ingress routes `/ws`
to realtime-gateway.

---

## 7. Environments

| Stage | Mechanism |
|-------|-----------|
| Single service | `mvnw spring-boot:run` + the service's own `docker-compose.yml` (DB only) |
| Whole system | root `docker compose up --build` with LocalStack and Redis |
| Cloud | EKS Fargate, RDS (Multi-AZ, per service), ElastiCache, SQS, EventBridge |

Local to cloud is a config swap (endpoints, credentials via env or Secrets Manager); the
service boundaries do not change.
