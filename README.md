# RideNow

A cloud-native ride-sharing **backend**, built as a Spring Boot microservices
monorepo. Passengers request rides, drivers accept and complete them. The product
is intentionally simple; the engineering underneath - concurrency, distributed
messaging, Redis, and a path to Amazon EKS - is the point.

Stack: **Java 25**, **Spring Boot 4.1.1**, PostgreSQL (one DB per service), Valkey (Redis protocol),
AWS SDK v2 (SNS + SQS), Docker, Kubernetes/EKS.

> Built **local-first**: every boundary runs against a local stand-in first
> (Postgres containers, a Valkey container, LocalStack for SNS/SQS), then
> the *same code* points at managed AWS by changing environment variables only.

---

## Services

| Service | Port | Owns | Notes |
|---------|------|------|-------|
| `user-service` | 8081 | accounts / profiles | — |
| `driver-service` | 8080 | drivers, vehicles; live driver state | live location/availability in **Valkey** (not Postgres); publishes location on a Pub/Sub channel (gateway) and appends it to a capped **Redis Stream** (matching); profile reads are cache-aside |
| `trip-service` | 8082 | trip lifecycle & state machine | optimistic-lock "exactly one driver wins"; estimates the fare and **authorizes it synchronously** with payment-service (no hold, no trip); publishes `trip.*`/`driver.*` events |
| `payment-service` | 8083 | payments | idempotent authorize -> capture / release; captures on `trip.completed` and releases on `trip.cancelled` from its own SQS queue; publishes `payment.*` events |
| `matching-service` | 8085 | matching decisions, `trip_offers` | matches **asynchronously** on `trip.requested` (SQS); finds nearby drivers via **Redis GEO** (swappable from a Postgres scan), kept current from the driver-locations **stream** through a consumer group (retried, dead-lettered); publishes `match.offered`; internal (no public route) |
| `notification-worker` | 8084 | notification inbox, delivery ledger | consumes the notifications SQS queue; idempotent, retries, dead-letter queue; writes each notification to an **inbox** the apps poll at `/api/notifications`; keeps the trip tracking pairing in Redis |
| `realtime-gateway` | 8086 | nothing (no database) | streams the driver's live position to the trip's passenger over **SSE** at `/live/trips/{tripId}/location` |

Each service is an independently deployable Spring Boot app with its own Postgres
database. Services never read each other's databases - they talk over HTTP or via
events, and store other services' identifiers as plain UUIDs.

---

## Architecture at a glance

```
            +-------------+        +---------------+
 Passenger  | user-service|        | driver-service |  Driver
   app  ---> | accounts    |        | drivers,       | <--- app
            +------+------+        | vehicles,      |
                   |              | live state(Redis)|
                   v              +-------+--------+
            +-------------------------------------+
            |            trip-service             |
            |  ride lifecycle / state machine     |
            +------+----------------------+-------+
                   |                      |
            needs a driver          trip/payment events
                   v                      v
            +-------------+        +------------------------+
            |matching-svc |        | SNS topic              |
            | Redis GEO   |        |  -> filter -> SQS queue|
            +------+------+        +-----------+------------+
                   |                           |
              +----+----+                      v
              | Valkey  |            +-------------------+
              | GEO/live|            |notification-worker|
              | /pubsub |            | SQS consumer+DLQ  |
              +---------+            +-------------------+
```

The two big distributed-systems boundaries:

- **Sync where the answer is needed now, async everywhere else.** Lifecycle
  changes publish domain events (after the DB commits) to one **SNS** topic. One
  subscription per consumer, with a filter policy on the event's `type`, delivers
  the raw event JSON into that consumer's own **SQS** queue
  (with a dead-letter queue): `trip.requested` -> matching,
  `trip.completed`/`trip.cancelled` -> payment, every event -> notifications.
  `notification-worker` writes each notification to its inbox table, which the apps
  poll. The driver's live position reaches the passenger over **SSE** from
  `realtime-gateway` (see `docs/REALTIME.md`). The event transport sits behind a
  `DomainEventPublisher` interface (logging default, SNS impl), so it's a
  swap, not a rewrite. See `docs/ARCHITECTURE.md` section 3.
- **Valkey** (ElastiCache for Valkey in the cloud; Redis protocol, so the Redis clients and
  REDIS_* variables are unchanged), five roles - primary store for live driver
  location/availability, **GEO** index for nearby-driver matching, **Pub/Sub** for live
  tracking, a **Stream** of driver locations that matching-service reads through a consumer
  group (so a restarted pod catches up), and **cache-aside** on the driver profile. It also
  holds the short-lived trip tracking pairing that tells the gateway who may watch whom.

---

## Run it locally

Everything runs with one command - all services, their databases, Valkey, and
LocalStack (local SNS + SQS):

```bash
cp .env.example .env         # once
docker compose up --build    # build images and start the whole system
docker compose ps            # watch health
docker compose down -v       # stop and wipe data
```

Ports are mapped to `localhost:<port>` per the table above (e.g.
`curl localhost:8082/api/trips`). Notifications are at
`localhost:8084/api/notifications?userId=...`, and the live driver position at
`curl -N "localhost:8086/live/trips/{tripId}/location?userId={passengerId}"`.
To check the whole running stack end to end, run `./scripts/api-test.ps1` (PowerShell,
about 2 minutes, exits non-zero on any failure). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) sections 3 and 8 for the end-to-end
async flow and the checks it was verified with, [`docs/REALTIME.md`](docs/REALTIME.md) for the
real-time design, and [`realtime-gateway/README.md`](realtime-gateway/README.md) for
the stream contract.

### Build / test a single service

```bash
cd trip-service
./mvnw test        # unit + web-slice tests; integration tests use Testcontainers
```

Integration tests (Testcontainers for Postgres / Valkey / LocalStack) are skipped
automatically when Docker isn't available. They need Docker running (verified with
Docker Engine 29 and Testcontainers 1.21.4). The `*ApplicationTests` context tests in
user, driver, trip and payment (and trip's `AcceptTripConcurrencyTest`) connect to a
Postgres on `localhost` (for example `5434` for user-service). `docker compose` does
not publish the database ports, so these fail unless such a database is running.

---

## Deploy to AWS

Two routes, same footprint:

- **Console, click-by-click** (backend -> EKS): start at
  [`guides/aws/README.md`](guides/aws/README.md) - IAM -> VPC -> ECR ->
  RDS/Secrets -> EKS -> deploy, with ElastiCache and SNS/SQS as later ops.
- **Infrastructure as Code** (CloudFormation + k8s manifests):
  [`iac/README.md`](iac/README.md).

Kubernetes manifests for all six services live in [`iac/k8s/`](iac/k8s/).

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - the local-first mental model:
  stable boundaries, swappable mechanisms.
- [`docs/KNOWLEDGE.md`](docs/KNOWLEDGE.md) - a table of every technique used and
  how it applies here.
- [`docs/database/ridenow.dbml`](docs/database/ridenow.dbml) - the logical data
  model (source of truth for persistent fields).
- [`docs/RideNow_Project_Proposal.md`](docs/RideNow_Project_Proposal.md) - the
  original scope and learning plan.
- [`docs/guides/`](docs/guides/) - step-by-step build and AWS-console guides.

---

## Conventions

- Layered structure per service: `controller` -> `service` -> `repository` ->
  `entity`, with `dto` at the API boundary and a focused `@RestControllerAdvice`
  for errors. Constructor injection; DTOs never expose entities.
- Flyway owns each schema (`V1__init_schema.sql`); JPA runs with
  `ddl-auto: validate`.
- Config is environment-driven (`${VAR:default}`), so the same image runs on a
  laptop, in Compose, and on EKS - only the environment changes.
