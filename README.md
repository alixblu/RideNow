# RideNow

A cloud-native ride-sharing **backend**, built as a Spring Boot microservices
monorepo. Passengers request rides, drivers accept and complete them. The product
is intentionally simple; the engineering underneath - concurrency, distributed
messaging, Redis, and a path to Amazon EKS - is the point.

Stack: **Java 25**, **Spring Boot 4.1.1**, PostgreSQL (one DB per service), Redis,
AWS SDK v2 (SQS + EventBridge), Docker, Kubernetes/EKS.

> Built **local-first**: every boundary runs against a local stand-in first
> (Postgres containers, a Redis container, LocalStack for SQS/EventBridge), then
> the *same code* points at managed AWS by changing environment variables only.

---

## Services

| Service | Port | Owns | Notes |
|---------|------|------|-------|
| `user-service` | 8081 | accounts / profiles | — |
| `driver-service` | 8080 | drivers, vehicles; live driver state | live location/availability in **Redis** (not Postgres); publishes location on a Pub/Sub channel; profile reads are cache-aside |
| `trip-service` | 8082 | trip lifecycle & state machine | optimistic-lock "exactly one driver wins"; publishes `trip.*`/`driver.*` events |
| `payment-service` | 8083 | payments | idempotent charges; publishes `payment.*` events |
| `matching-service` | 8085 | matching decisions, `trip_offers` | finds nearby drivers via **Redis GEO** (swappable from a Postgres scan); internal (no public route) |
| `notification-worker` | 8084 | delivery state | consumes the SQS queue; idempotent, retries, dead-letter queue; no business HTTP API |

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
            |matching-svc |        | EventBridge bus        |
            | Redis GEO   |        |  -> rule -> SQS queue  |
            +------+------+        +-----------+------------+
                   |                           |
              +----+----+                      v
              |  Redis  |            +-------------------+
              | GEO/live|            |notification-worker|
              | /pubsub |            | SQS consumer+DLQ  |
              +---------+            +-------------------+
```

The two big distributed-systems boundaries:

- **Async notifications** - trip/payment lifecycle changes publish domain events
  (after the DB commits) to **EventBridge**; a rule routes them to an **SQS**
  queue; `notification-worker` consumes them exactly once, with retries and a
  dead-letter queue. The transport sits behind a `DomainEventPublisher` interface
  (logging default, EventBridge impl), so it's a swap, not a rewrite.
- **Redis**, four roles - primary store for live driver location/availability,
  **GEO** index for nearby-driver matching, **Pub/Sub** for live tracking, and
  **cache-aside** on the driver profile.

---

## Run it locally

Everything runs with one command - all services, their databases, Redis, and
LocalStack (local SQS + EventBridge):

```bash
cp .env.example .env         # once
docker compose up --build    # build images and start the whole system
docker compose ps            # watch health
docker compose down -v       # stop and wipe data
```

Ports are mapped to `localhost:<port>` per the table above (e.g.
`curl localhost:8082/api/trips`). See
[`docs/guides/stage-11a-local-async-messaging.md`](docs/guides/stage-11a-local-async-messaging.md)
for the end-to-end async flow and how to observe it.

### Build / test a single service

```bash
cd trip-service
./mvnw test        # unit + web-slice tests; integration tests use Testcontainers
```

Integration tests (Testcontainers for Postgres / Redis / LocalStack) are skipped
automatically when Docker isn't available.

---

## Deploy to AWS

Two routes, same footprint:

- **Console, click-by-click** (backend -> EKS): start at
  [`localfile/aws/README.md`](localfile/aws/README.md) - IAM -> VPC -> ECR ->
  RDS/Secrets -> EKS -> deploy, with ElastiCache and SQS/EventBridge as later ops.
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
