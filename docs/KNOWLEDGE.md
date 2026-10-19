# RideNow - Knowledge Table

Remarkable techniques used (or planned) in this project. Each row: the technique, a
short description, and how it applies in RideNow.

## Core backend & data

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Microservices | Small, independently deployable services, each owning its own data | user / driver / trip (+ matching, payment, notification-worker later), each its own Spring Boot app and its own Postgres DB |
| Database-per-service | Each service owns its database; no shared tables, no cross-service joins | driver-db (5433), user-db (5434), trip-db (5435) - separate Postgres containers; services never read another service's tables |
| Cross-service reference by ID | Store another service's identifier as a plain value, not a FK/JPA relationship | `drivers.user_id`, `trips.passenger_id`/`driver_id` are UUID columns, not `@ManyToOne` joins |
| Layered architecture | controller -> service -> repository -> entity, each with one job | Every service: thin controller, business rules in service, persistence in repository, JPA entity for rows |
| DTO at the boundary | Expose request/response DTOs, never entities, at the API edge | `CreateDriverRequest` in, `DriverResponse` out; entity stays internal |
| Bean validation | Reject malformed input at the controller with `@Valid` + Jakarta annotations | `@Valid @RequestBody CreateDriverRequest` -> 400 on bad input |
| Centralized error handling | One place maps exceptions to clean HTTP responses | `@RestControllerAdvice GlobalExceptionHandler` -> 404/409/400/503, never raw stack traces |
| Flyway migrations | Versioned SQL owns the schema; app validates against it | `V1__init_schema.sql` (schema) + `R__seed_demo_data.sql` (~100 rows) per service; `ddl-auto: validate` as drift safety net |

## Concurrency

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Optimistic locking | A `version` column; an update wins only if the version is unchanged, else it is rejected | THE signature feature: accept-ride. `@Version` on Trip; 50 simultaneous accepts -> exactly one wins (WINNERS=1 LOSERS=49) |
| Pessimistic locking (alt) | Lock the row (`SELECT ... FOR UPDATE`) so others wait | Noted as an alternative to optimistic; not used - optimistic fits "many drivers, one ride" better |
| Single-writer boundary | Keep a contested write inside ONE service + ONE DB so the lock actually protects it | accept-ride write lives only in trip-service; matching-service only proposes candidates |
| Idempotency | A repeated request with the same key produces no duplicate effect | payment-service (planned): `idempotency_key` so a retried charge does not double-charge |

## Communication

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Synchronous HTTP (request/response) | Caller needs an answer now; direct call | driver-service calls user-service `GET /api/users/{id}` to verify a user exists before creating a driver (Spring `RestClient`) |
| Service discovery | Reach a service by name; the platform's DNS resolves it to an instance | local: `localhost:8081` (config); Docker: `http://user-service`; Kubernetes: Service DNS + load-balancing. URL is config, code unchanged |
| Asynchronous messaging | Producer hands off work; consumer processes later, decoupled | notifications, payment side-effects (planned). Local = outbox table + poller; cloud = SQS |
| Message queue (SQS) | Durable work queue: one producer -> one consumer group; retries + DLQ | Reasons: async, decoupling, buffering, reliability. Notifications/payments - must-not-lose async work |
| Outbox pattern | Write the message as a DB row in the same transaction as the change; a poller publishes it | Local stand-in for SQS: avoids the dual-write problem; swaps to SQS publish in the cloud with no business-code change |
| Fan-out (pub/sub) | One event delivered to many independent consumers | EventBridge (planned) when one event (e.g. "trip completed") needs multiple reactors (notifications + analytics + payment) |
| EventBridge vs SNS | Both do fan-out; pick ONE | DECISION: SQS + EventBridge; SNS not used (EventBridge already covers fan-out) |
| Publisher behind an interface | Hide the transport behind an interface so it can be swapped | `NotificationPublisher` (planned): outbox impl locally -> SQS impl in cloud; business logic unchanged |

## Redis

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Redis as primary store | Redis is the ONLY home of some data (not a cache of the DB) | Live driver location/availability lives ONLY in Redis - never in Postgres (DBML says so); ephemeral, re-reported by the app |
| Redis GEO | Geospatial radius queries in-memory | matching-service (planned): "find available drivers near this pickup" - the headline reason Redis is in the architecture |
| Redis Pub/Sub | Fire-and-forget real-time fan-out; NOT durable | Backend side of live tracking: a driver's GPS update is published on a channel so the passenger's connection can receive it. Loss-tolerant, latest-value-wins; NOT a replacement for SQS |
| WebSockets | Persistent two-way connection pushing updates to the client in real time | Delivery channel for live driver location: Redis Pub/Sub -> backend -> WebSocket -> passenger map. The open socket lets the backend push each new position without the client polling (planned, with Redis Pub/Sub) |
| Cache-aside (caching) | Store a disposable copy of slow/hot DB data with a TTL | Optional, secondary: e.g. driver/user profile. Rule: off by default; cache only a proven read-heavy, staleness-tolerant endpoint; NEVER the accept-ride read |

## Security (defense in depth)

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Defense in depth | Multiple independent layers; if one fails, another still protects | Invariants guarded at several layers at once (see rows below) |
| Layered invariant enforcement | Validate at the edge AND enforce in the service AND constrain in the DB | Uniqueness: service `existsByLicenseNumber` check + DB `UNIQUE` constraint + (for accept) `@Version` lock |
| AWS Security Groups | Per-resource firewall at the AWS network level | Planned: RDS accepts connections only from the service's security group, not the internet |
| Kubernetes NetworkPolicy | Restrict which Pods may talk to which | Planned: limit Pod-to-Pod traffic so a compromised service can't reach everything |
| Application authorization | Control which users/services may perform an action | Planned (JWT/Spring Security): verified at the service, not just assumed past the gateway |
| Zero Trust | Never trust a request just because it is "inside" the network; verify identity each time | Each service re-verifies authz rather than trusting the perimeter |
| Least privilege | Give each service only the permissions it needs | Planned: scoped IAM roles, per-service DB users, narrow SQS/EventBridge permissions |
| Microsegmentation | Divide the network into small zones to limit lateral movement | VPC subnets + security groups + NetworkPolicy keep a breach contained to one zone |
| Secrets management | Keep credentials out of source/config | local: `application.yaml`; cloud: AWS Secrets Manager + IAM role auth (no long-lived keys) |
| Blast-radius containment | Service boundaries limit how far a breach spreads | A compromised driver-service reaches only its own DB, not users or payments |
| Safe error responses | Return clean errors, never internals | `GlobalExceptionHandler` returns DTOs (4xx), never stack traces or persistence internals |

## Local-first & cloud migration

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Local-first, swap mechanism | Keep boundaries fixed; build the simplest local mechanism, swap to the managed one later | Postgres->RDS, outbox->SQS, in-code state->Redis, `mvn run`->EKS. Boundaries never move, so migration is substitution not rewrite |
| Config-driven endpoints | Addresses/credentials in config, not hardcoded | user-service URL, DB URL in `application.yaml`; swap per environment (local/Docker/k8s) without code changes |
| Containerization | Package the app as a portable image | Planned (Stage 5-6): multi-stage Dockerfile; same image runs locally and on EKS |
| Managed database (RDS) | Cloud-run PostgreSQL | Planned (Stage 9): same engine/version as local, so entities/SQL/Flyway behave identically |
| Image registry (ECR) | Versioned store for Docker images | Planned (Stage 10): push the service image; EKS pulls from here |

## Kubernetes / EKS (planned)

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Pod | The smallest deployable unit - a running container instance | Each service runs as Pods on EKS |
| Deployment | Manages replicas and rolling updates of Pods | Declares how many replicas of driver-service, which image, update strategy |
| Service (k8s) | Stable internal name + load-balancing across Pods | This IS the service-discovery mechanism: `http://user-service` resolves and load-balances |
| Ingress / ALB | Routes external HTTP traffic into the cluster | Planned (Stage 13): expose services to the outside world |
| ConfigMap / Secret | Non-sensitive config / sensitive config injected into Pods | ConfigMap for settings; Secret (or Secrets Manager) for DB credentials |
| Readiness/Liveness probes | k8s checks "ready for traffic?" / "still alive?" | Uses the Spring Actuator `/actuator/health` endpoint already enabled |
| Horizontal Pod Autoscaler (HPA) | Add/remove Pods based on metrics (e.g. CPU) | Planned (Stage 13): scale under load |
| Requests/Limits | Reserve/cap CPU & memory per container | Planned: protect the cluster from a runaway Pod |
| EKS | AWS-managed Kubernetes control plane + nodes | The final deployment target; same manifests you'd run on local k8s |

## Resilience (planned, distributed flows)

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Dead-letter queue (DLQ) | Messages that keep failing go to a side queue for inspection | SQS consumers (notifications): failed messages land in a DLQ instead of being lost |
| Retries + backoff | Re-attempt a failed operation, waiting longer each time | Queue consumers and upstream HTTP calls |
| Timeouts | Bound how long to wait on a dependency | HTTP calls to other services (so a slow user-service can't hang driver-service) |
| Circuit breaker | Stop calling a failing dependency for a while to let it recover | Planned resilience step for service-to-service calls |
| Saga / compensation | Undo prior steps when a later step fails, instead of a cross-service transaction | payment failure: reconcile the trip via explicit state + compensating action, not a distributed transaction |
