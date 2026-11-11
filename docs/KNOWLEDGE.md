# RideNow - Knowledge Table

The techniques RideNow uses or plans to use. Each row gives the technique, a short
description, and how it shows up here.

- **BUILT**: in the code and verified.
- **PARTIAL**: some of it is built; the row says what is missing.
- **PLANNED**: not built yet.

See `ARCHITECTURE.md` for how these fit together.

## Core backend & data

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Microservices | Small, independently deployable services, each owning its own data | BUILT: seven Spring Boot apps: user, driver, trip, payment, matching, notification-worker, realtime-gateway |
| Database-per-service | Each service owns its database; no shared tables or cross-service joins | BUILT: one Postgres per service. realtime-gateway has none. matching-service gets driver positions through an explicit handoff, not by reading driver-service's store |
| Cross-service reference by ID | Store another service's id as a plain value, not a FK or JPA relationship | BUILT: `drivers.user_id`, `trips.passenger_id` / `driver_id`, and `payments.trip_id` are UUID columns |
| Layered architecture | controller -> service -> repository -> entity, each with one job | BUILT: thin controllers, rules in services, persistence in repositories |
| DTO at the boundary | Expose request/response DTOs, never entities | BUILT: e.g. `CreateTripRequest` in, `TripResponse` out |
| Bean validation | Reject malformed input with `@Valid` + Jakarta annotations | BUILT: e.g. a trip request without `paymentMethod` -> 400 |
| Centralized error handling | One place maps exceptions to clean HTTP responses | BUILT: `@RestControllerAdvice` per service -> 400/402/404/409/503, never stack traces |
| Flyway migrations | Versioned SQL owns the schema; the app validates against it | BUILT: `V1__init_schema.sql` and `R__seed_demo_data.sql` per service, `ddl-auto: validate` |
| DBML as source of truth | One schema document drives every entity and migration | BUILT: `docs/database/ridenow.dbml`; schema changes are proposed there first (e.g. payment `AUTHORIZED` / `RELEASED`) |
| Strategy behind an interface | Swap an implementation by config without touching callers | BUILT: `NearbyDriverFinder` (Postgres / Redis GEO), `PaymentGateway`, `DomainEventPublisher`, `NotificationSender`, `ClientChannel` |

## Concurrency & consistency

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Optimistic locking | A `version` column; an update wins only if the version is unchanged | BUILT, the signature feature: `@Version` on Trip. 50 simultaneous accepts -> exactly one winner |
| Pessimistic locking (alt) | Lock the row (`SELECT ... FOR UPDATE`) so others wait | Considered and not used. Optimistic fits "many drivers, one ride" better |
| Single-writer boundary | Keep a contested write inside one service and one DB | BUILT: the accept decision lives only in trip-service; matching only proposes candidates |
| Idempotency key | A repeated request with the same key has no extra effect | BUILT: payment authorize uses the trip id as its key, so a retried `POST /trips` cannot hold twice |
| Idempotent state transition | An action on an already-final state is a no-op | BUILT: capture / release do nothing unless the payment is `AUTHORIZED`, so duplicate events cannot double-charge |
| Authorize-then-capture | Hold funds up front, charge the final amount later | BUILT: sync authorize on trip request; async capture on `trip.completed`, release on `trip.cancelled` |
| Saga / compensation | Undo or offset an earlier step instead of a cross-service transaction | BUILT: if the trip cannot be saved after a hold, a compensating `trip.cancelled` releases it. A failed capture -> `FAILED` + `payment.failed` |
| Eventual consistency | Services agree after a short delay rather than instantly | BUILT: offers, capture and notifications all follow the trip via events, seconds later |

## Communication

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Synchronous HTTP | Caller needs an answer now; direct call | BUILT: driver -> user (validate the user exists); trip -> payment (authorize the fare). Uses Spring `RestClient` |
| Strict vs lenient dependency | Decide whether a down dependency blocks the request | BUILT (strict): payment-service down -> `POST /trips` returns 503 and saves nothing |
| Service discovery | Reach a service by name; platform DNS resolves it | BUILT: the URL is config. Compose: `http://payment-service:8083`; Kubernetes: Service DNS |
| Domain events | A service announces "this happened"; others react | BUILT: `trip.*`, `driver.*`, `match.offered`, `payment.*`. Each carries `eventId`, `type`, `version`, `occurredAt` and flat `data` |
| Publish after commit | Send the event only once the DB transaction committed | BUILT: `@TransactionalEventListener(AFTER_COMMIT)`. A rollback publishes nothing |
| Outbox pattern | Write the event in the same transaction; a poller publishes it | PLANNED: publish-after-commit is the current stand-in. It loses an event if the process dies right after commit |
| Fan-out | One event delivered to many independent consumers | BUILT: EventBridge bus with one rule per consumer, matched on `detail-type` |
| Message queue (SQS) | Durable work queue: retries, visibility timeout, DLQ | BUILT: matching, payment and notifications queues, one per consumer, each with a DLQ |
| EventBridge vs SNS | Both do fan-out; pick one | DECISION: EventBridge + SQS. SNS is not used |
| Publisher behind an interface | Hide the transport so it can be swapped | BUILT: `DomainEventPublisher` in trip, payment and matching. Logging by default, EventBridge under the `eventbridge` profile |
| Tolerant reader | Consumers ignore fields they do not know | BUILT: `@JsonIgnoreProperties(ignoreUnknown = true)` on every incoming event record, with no shared contract module |

## Redis

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Redis as primary store | Redis is the only home of some data | BUILT: driver live availability and position (hash with TTL), never in Postgres |
| Redis GEO | In-memory geospatial radius queries | BUILT: matching-service's GEO index answers "drivers near this pickup" with GEOSEARCH |
| Redis Pub/Sub | Fire-and-forget fan-out to everyone connected; not durable | BUILT: driver location channel, and the `ridenow.notifications` channel from notification-worker to every gateway pod |
| Cache-aside | A disposable copy of hot DB data with a TTL | BUILT (scoped): driver profile only; evicted on writes. Never trip status or the accept read |

## Real-time

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| WebSockets + STOMP | Persistent two-way connection; STOMP adds topics and subscriptions | BUILT: realtime-gateway at `/ws`; clients subscribe to `/topic/users/{userId}` |
| Stateless socket tier via Pub/Sub | Every pod subscribes to the backplane; the pod holding the socket delivers | BUILT: no sticky sessions; the gateway scales horizontally |
| Socket is not the source of truth | Re-fetch state over REST on (re)connect; the stream only adds updates | BUILT (contract): documented in the gateway README; messages carry `eventId` and `occurredAt` for dedupe |
| Heartbeats | Periodic pings so dead connections are noticed | BUILT: STOMP heartbeats every 10s in both directions |
| Graceful drain | On shutdown, ask clients to reconnect instead of cutting them | BUILT: close code `1001` "reconnect", with `preStop` sleep and a termination grace period in Kubernetes |
| Reconnect with backoff + jitter | Retry later and later, randomized, so clients do not stampede | BUILT (verified with a test client): plus a connect timeout for half-open handshakes |
| Inbound guard | Limit what a client may do over the socket | BUILT: receive-only; exact per-user topics only (no wildcards); caps on frame size, subscriptions and frame rate |
| Transport choice | WebSocket vs SSE vs UDP / WebRTC / QUIC | DECISION: WebSocket. Traffic is small and low-rate, so the others are deferred unless load tests show head-of-line blocking |
| Mobile push | Reach a closed or backgrounded app via FCM / APNs | PLANNED (out of scope): a WebSocket reaches only foreground apps |

## Resilience

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Dead-letter queue | Messages that keep failing move aside for inspection | BUILT: each queue dead-letters after 5 receives (verified) |
| Idempotent consumer | A repeated delivery has no duplicate effect | BUILT: notification ledger (`processed_notifications`); a matching skip if offers exist; payment no-op transitions |
| Drop vs retry | Retry only what can succeed later; drop poison data | BUILT: consumers drop malformed events and let real failures retry into the DLQ |
| Timeouts | Bound how long to wait on a dependency | PARTIAL: trip -> payment has connect and read timeouts (2s / 3s); driver -> user has none |
| Retries + backoff | Re-attempt with growing delays | PARTIAL: SQS redelivery covers consumers; sync HTTP calls have none |
| Circuit breaker | Stop calling a failing dependency for a while | PLANNED |
| Health probes split | Liveness = restart me; readiness = route to me | PARTIAL: realtime-gateway splits them (Redis affects readiness only); others share `/actuator/health` |

## Security (defense in depth)

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Layered invariant enforcement | Validate at the edge, enforce in the service, constrain in the DB | BUILT: e.g. a service uniqueness check + DB `UNIQUE` + `@Version` for accept |
| Least privilege (IAM) | Each service gets only the permissions it needs | BUILT: per-service messaging policies scoped to exact queue / bus ARNs; one IRSA role per service |
| Resource policy scoping | The target also restricts who may write to it | BUILT: each SQS queue accepts messages only from its own EventBridge rule (`aws:SourceArn`) |
| IRSA (IAM Roles for Service Accounts) | Pods get AWS credentials from their service account, not static keys | BUILT: trip, payment, matching, notification-worker; plus the ALB controller and External Secrets |
| Secrets management | Keep credentials out of source and config | BUILT: Secrets Manager -> External Secrets -> Kubernetes Secret. Local: `.env` |
| Network isolation | Data tiers private; one public entry point | BUILT: RDS and Redis in private subnets; only the ALB is public; services are `ClusterIP` |
| Encryption | At rest and in transit | PARTIAL: RDS, SQS and Redis are encrypted at rest; Redis in transit for worker and gateway. Not driver / matching, and no TLS at the ALB |
| Safe error responses | Clean errors, never internals | BUILT: `GlobalExceptionHandler` DTOs |
| Application authN/Z | Verify who the caller is and what they may do | PLANNED: JWT / Spring Security, including at WebSocket `CONNECT`. Today anyone knowing a user id can subscribe |
| East-west restriction | Limit which pods may call which | PLANNED: per-service security groups naming allowed callers (NetworkPolicy is not enforced on Fargate) |
| Edge protection | TLS, WAF and source restriction at the load balancer | PLANNED: the ALB is HTTP:80 today |

## Platform: containers, Kubernetes, AWS

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Local-first, swap mechanism | Keep boundaries fixed; swap local stand-ins for managed services | BUILT: Postgres -> RDS, LocalStack -> SQS / EventBridge, Redis container -> ElastiCache, Compose -> EKS. Config only |
| LocalStack | Local emulator for AWS APIs | BUILT: `localstack/init/01-messaging.sh` creates the same bus, queues and rules as stack 05; `smoke-test.sh` checks routing |
| Containerization | Package each app as a portable image | BUILT: multi-stage Dockerfile per service; one image runs locally and on EKS |
| Docker Compose | Run the whole system on one machine | BUILT: 6 Postgres, Redis, LocalStack and 7 services with health checks |
| Infrastructure as code | Declarative, reviewable infrastructure | BUILT: seven CloudFormation stacks wired by exports and imports; `cfn-lint` clean; dry-run by default |
| EKS on Fargate | Managed Kubernetes with serverless pods | BUILT (codified, not deployed in this pass): no node groups to patch or scale |
| Deployment / Service / Ingress | Replicas, stable internal names, external routing | BUILT: one manifest per service in `iac/k8s/`; the ALB routes four APIs plus `/ws` |
| Rolling update tuning | Control how many pods are replaced at once | BUILT: realtime-gateway uses `maxUnavailable: 0`, `maxSurge: 1` |
| HPA | Scale pods on a metric | BUILT (CPU): connection- or queue-depth-based scaling is a gap |
| Requests / limits | Reserve and cap CPU and memory | BUILT on every service |
| Observability | Metrics, logs, traces to investigate failures | PARTIAL: health endpoints and Fargate log routing. No metrics, tracing or correlation ids yet |

## Testing

| Technique | Basic description | How it is used in this project |
|-----------|-------------------|-------------------------------|
| Unit tests with mocks | Test rules in isolation | BUILT: service, handler and consumer tests in every service |
| Web-slice tests | Test the HTTP boundary only | BUILT: `@WebMvcTest` for status codes and the error shape |
| Contract tests for events | Pin the JSON each event carries | BUILT: `TripEventsTest`, `RedisNotificationSenderTest` |
| Real-socket integration test | Drive the real STOMP stack with real clients | BUILT: gateway delivery, reconnect, wildcard rejection, graceful close, probes |
| Concurrency test | Many threads race; assert the invariant | BUILT: `AcceptTripConcurrencyTest` |
| Testcontainers | Real Postgres / LocalStack in tests | BUILT, but blocked on the dev machine (cannot reach Docker Engine 29) |
| End-to-end failure drills | Kill or duplicate things on purpose and observe | BUILT (manual): payment down, consumer down, duplicate event, poison message, gateway restart (see `ARCHITECTURE.md` section 8) |
| Load testing | Measure latency, throughput, scaling | PLANNED (k6) |
