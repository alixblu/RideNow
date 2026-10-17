# RideNow Architecture - The Local-First Mental Model

This document explains how RideNow is *meant* to be understood and built: as a set of
stable boundaries, where each boundary starts with the simplest possible mechanism and is
later swapped for its "real" counterpart. Nothing here replaces the proposal
(`RideNow_Project_Proposal.md`) or the step list (`LEARNING_PATH.md`) - it is the mental
model that makes both of them click, and makes the eventual cloud migration feel boring.

---

## 0. Decisions locked (the short list of what we actually do)

The settled choices, each with a one-line reason. Details follow in later sections.

| Area | Decision | Why |
|------|----------|-----|
| Service calls (need answer now) | Direct HTTP | Synchronous request/response; already built in Stage 4 |
| Async work queue (do-it-later, one consumer) | **SQS** | Durable, retries, DLQ; the messaging workhorse |
| Event fan-out (one event, many consumers) | **EventBridge** | Proposal commits to it; pick ONE fan-out tool |
| SNS | **Not used** | EventBridge already covers fan-out; two tools, one job |
| Local messaging (before cloud) | Outbox table + poller (Postgres) | Learn the concept with no broker; swap to SQS later |
| Live driver location | **Redis = primary store, NOT in Postgres** | Ephemeral, high-write, geo-queried; DBML says keep it out of the DB |
| Find nearby drivers | Postgres query first, then **Redis GEO** | Feel the limit before adding Redis |
| Live location to rider | Redis Pub/Sub + WebSockets | Real-time, loss-tolerant stream |
| Caching | Off by default; add per-endpoint only when proven hot + staleness-tolerant | Caching everything causes stale-data bugs |
| Accept-ride concurrency | Optimistic lock (`@Version`) in trip-service, one DB | Exactly-one-winner; already built & proven |
| Schema + seed data | Flyway (`V1` schema, `R` seed) per service, `validate` | One source of truth; done |
| Durable data | Postgres per service (RDS in cloud) | Database-per-service rule |
| Running services | `mvn run` -> Docker -> local k8s -> EKS | Local-first, migrate last |

Deferred until a feature needs them: SQS, EventBridge, Redis, WebSockets, Saga,
Docker images for the apps, Kubernetes, all AWS. Do not adopt early.

---

## 1. The one idea that makes migration easy

> Keep the architecture (the boundaries) fixed. Change only the mechanism behind each
> boundary, one at a time.

A "boundary" is a place where one part of the system talks to another:
- a service calling another service
- a service sending a notification
- a service storing data
- a service finding nearby drivers
- a service running somewhere

For every boundary, there is a **boring local mechanism** you build first and a **real
mechanism** you swap in later. Because the boundary does not move, swapping the mechanism
is a substitution, never a redesign. That is the whole trick to "build locally, migrate
easily".

The discipline that enables it: **put every boundary behind something you control** - an
interface, a config value, a small client class. Your business logic talks to the
interface; the mechanism hides behind it. You already did this once in Stage 4 by making
the user-service URL a config value instead of a hardcoded string. Same move, everywhere.

---

## 2. The system as boundaries (this never changes)

```
            +-------------+        +--------------+
 Passenger  | user-service|        | driver-service|  Driver
   app  ---> | accounts    |        | drivers,      | <--- app
            +------+------+        | vehicles      |
                   |               +-------+-------+
                   |                       |
                   v                       v
            +-------------------------------------+
            |            trip-service             |
            |  ride lifecycle / state machine     |
            +------+----------------------+-------+
                   |                      |
          needs a driver            trip completed
                   |                      |
                   v                      v
            +-------------+        +----------------+
            |matching-svc |        | payment-service|
            |find a driver|        | charge the trip|
            +-------------+        +--------+-------+
                                            |
                                     "trip paid" happened
                                            |
                                            v
                                   +-------------------+
                                   |notification-worker|
                                   | tell the people   |
                                   +-------------------+
```

Rules that hold at every stage (local or cloud), straight from AGENTS.md:
- Each service owns its own database. No shared tables, no cross-service joins.
- Services reach each other only through an explicit API or a message - never by reading
  another service's database.
- Cross-service references are stored as plain IDs (e.g. `userId` as a UUID), not JPA
  relationships.

---

## 3. The substitution table (what to build now vs later)

| Boundary / concept        | Boring version FIRST (local)                      | Real version LATER (the lesson)        |
|---------------------------|---------------------------------------------------|----------------------------------------|
| Service-to-service call   | Direct HTTP call (RestClient) - Stage 4           | Same + timeouts, retries, circuit breaker |
| Async notification        | "Outbox" table + a scheduled poller sends it      | AWS SQS (queue) + DLQ                   |
| Events between services   | A direct call, or an outbox row the other reads   | AWS EventBridge                        |
| Find nearby drivers       | A plain PostgreSQL query (even a naive one)       | Redis GEO (ElastiCache in cloud)       |
| Shared/live driver state  | A column in Postgres, polled                      | Redis (shared, fast, TTL)              |
| Live location to rider    | Rider polls an HTTP endpoint                      | WebSockets + Redis Pub/Sub             |
| Running a service         | `mvn spring-boot:run`                             | Docker -> local Kubernetes -> AWS EKS  |
| Config                    | `application.yaml`                                | ConfigMap -> env                       |
| Secrets                   | `application.yaml` (local only)                   | Kubernetes Secret -> AWS Secrets Manager |
| Database                  | Postgres in a container                           | Amazon RDS PostgreSQL                  |
| Image storage             | local `docker build`                              | Amazon ECR                             |

Read the table left to right as a learning sequence. You never jump straight to the right
column. You earn each move by first making the left column work and feeling its limits.

---

## 4. Why learn the LOCAL equivalent before the AWS service

The hard part is the *concept*, not the vendor. Learn it with the simplest local mechanism
first; the AWS service is the same concept, managed.

- **Messaging:** outbox table + poller (Postgres only, no broker) -> then SQS. Same
  producer/consumer/retry/DLQ/idempotency concepts; only the implementation behind the
  `NotificationPublisher` interface swaps. (RabbitMQ is not used - the outbox teaches the
  same lessons and SQS is the destination.)
- **Kubernetes:** Deployments/Services/probes on local k8s (Docker Desktop or `kind`) ->
  then EKS. The manifests are ~90% the same.

**Introduce each only when a feature needs it:** notifications -> async messaging (outbox,
then SQS); "stay up and scale" -> orchestration (local k8s, then EKS). Adopting a solution
before you have its problem is the trap the proposal warns about.

---

## 5. The recommended build order (reframed)

This refines the proposal's roadmap around the local-first idea. Phases map to
`LEARNING_PATH.md` stages.

1. **Working two-service system, HTTP only.** user + driver, each with its own DB, talking
   over HTTP. (You are here - Stages 1-4.)
2. **Trip lifecycle in trip-service.** A state machine (REQUESTED -> ... -> COMPLETED),
   transactions, validation. Still just HTTP + Postgres.
3. **The concurrency lab.** Two drivers accept one ride; prove exactly one wins using
   optimistic/pessimistic locking. Pure Postgres + Java. This is the project's signature
   problem and needs NO queue, NO Redis, NO cloud.
4. **Matching, the boring way.** matching-service finds a driver with a Postgres query.
   Feel why that is slow/awkward -> THEN introduce Redis GEO as the fix.
5. **Async notifications.** Add the outbox table + poller (Postgres only). Feel its limits
   -> THEN (in the cloud phase) publish from the outbox to SQS, with a worker + DLQ.
6. **Payment + failure handling.** Payment can fail; handle it with explicit state and
   compensation (the Saga idea) instead of a cross-service transaction.
7. **Events.** Where a direct call is too tight a coupling, publish an event. Local first,
   EventBridge later.
8. **Containerize** every service (Docker). The system runs as images.
9. **Local Kubernetes.** Run the images as Deployments/Services on Docker Desktop k8s or
   kind. Learn Pods, probes, scaling - for free.
10. **AWS, console first, then CloudFormation.** IAM, VPC, RDS, ECR, ElastiCache, SQS,
    EventBridge - each clicked once, then codified.
11. **EKS.** Deploy the same manifests to managed Kubernetes.
12. **Observability, CI/CD, load & failure testing.**

The migration to cloud (steps 10-11) is deliberately late and deliberately dull: by then
every mechanism already has a working local version, so the cloud is "same concept,
managed by AWS."

---

## 6. How to tell if you are doing it right

At any point, you should be able to answer, for each boundary:
- What mechanism is behind it right now? (HTTP? outbox? Redis?)
- What problem would make me upgrade that mechanism?
- If I swapped the mechanism, how much of my business code would change? (Answer should be:
  almost none, because it is behind an interface/config.)

If swapping a mechanism would force you to rewrite business logic, the boundary leaked -
fix that before adding anything new.

---

## 7. What this means for the next step

You are at the end of the HTTP-only two-service system. The next concept that teaches the
most, with zero new infrastructure, is the **trip lifecycle + the concurrency lab** - the
heart of the whole project - all on Postgres you already run. Messaging, Redis, and
Kubernetes come after, each when a feature finally needs it.


---

## 8. Messaging, Redis, and caching - decision guide

Notes from design discussion. The theme: each tool has ONE job it is best at; do not
substitute them for each other, and do not adopt any of them before a feature needs it.

### 8.1 Synchronous vs asynchronous - pick per interaction, not per project

Two kinds of service-to-service interaction, each wants a different tool:

- **"I need an answer now"** (synchronous) -> a direct **HTTP call**.
  Example: driver-service creating a driver must know right now whether the user exists.
  Already built this way in Stage 4. Do NOT route this through a queue.
- **"This happened; react whenever"** (asynchronous) -> a **queue / event**.
  Example: trip completed -> send a notification; the trip must not wait for it.

Do NOT make the whole project message-based. Most interactions are synchronous HTTP or
stay inside one service's database. Introduce async messaging per feature.

### 8.2 SQS vs SNS vs EventBridge - two different jobs

- **Work queue** (one producer -> one consumer group, "do this later"): **plain SQS**.
  This is the workhorse. Notifications, payment side-effects. Use this most of the time.
- **Fan-out** (one event -> many independent consumers): **SNS+SQS** OR **EventBridge**.
  SNS and EventBridge are ALTERNATIVES to each other, not additions - pick ONE.
  RideNow commits to EventBridge, so prefer SQS + EventBridge and skip SNS, unless you
  specifically want to learn the SNS->SQS pattern.

Do not adopt SNS + SQS + EventBridge together; that is three tools for two jobs.

| Need                                   | Use                        |
|----------------------------------------|----------------------------|
| Do one task later, reliably            | SQS                        |
| One event, several independent reactors| SQS + EventBridge (one fan-out tool) |
| Request/response, need answer now      | HTTP (not messaging)       |

### 8.3 Redis Pub/Sub is NOT a replacement for SQS

They look similar (both deliver messages) but differ fundamentally:

- **Redis Pub/Sub = fire-and-forget.** Delivered only to whoever is connected at that
  instant. No storage, no retry, no DLQ, no acknowledgment. If a subscriber is down or
  crashes mid-processing, the message is lost forever.
- **SQS = store-and-forward.** Durable until processed; retries on failure; dead-letter
  queue; at-least-once delivery.

So:
- **Durable, must-not-lose, retryable work** (notifications, payments) -> **SQS**. Never
  Redis Pub/Sub - losing a payment event is unacceptable.
- **Real-time, disposable, latest-value-wins streams** (live driver location to the
  passenger map) -> **Redis Pub/Sub** is the BETTER choice: lowest latency, and a dropped
  GPS ping does not matter because another arrives a second later.

(Nuance: Redis *Streams* - distinct from Pub/Sub - do offer durability/replay, closer to a
queue. But plain Pub/Sub does not, and Streams still lack SQS's managed DLQ/visibility
ergonomics. Keep the split: SQS for durable jobs, Redis Pub/Sub for live streams.)

### 8.4 Redis is NOT "just a cache" in RideNow

Redis has four roles here; caching is the smallest:

1. **Geospatial store (the headline role).** Redis GEO answers "find available drivers
   near this point" in milliseconds. Live location is the PRIMARY data here, deliberately
   kept OUT of Postgres (the DBML says so). This is why Redis is in the architecture.
2. **Shared/live state.** Online/offline + current position: fast-changing, read by many,
   ephemeral. Kept in Redis to avoid hammering Postgres.
3. **Pub/Sub for live tracking** (see 8.3).
4. **Cache** (cache-aside) - optional, secondary.

Cache = a disposable copy whose real home is Postgres. GEO/live-state = Redis IS the home
(losing it is acceptable; the driver app re-reports).

### 8.5 Should every DB read be cached? No.

Caching is a targeted optimization, not a default. Caching everything makes the system
slower, buggier (two copies of the truth that can disagree), and wastes RAM.

**Cache a read only when ALL of these hold:**
- read far more often than it changes (high read:write ratio), AND
- it tolerates being slightly stale for the TTL, AND
- you have measured it as a real hot path.

**Mapped to RideNow:**
- Good candidate: user/driver **profile** (read often, changes rarely).
- NEVER cache: trip status and the accept-ride read (correctness-critical, changes
  constantly) - a stale read here would break the exactly-one-winner guarantee.
- Not caching at all: live driver location (Redis is its primary store, not a cache of it).
- Pointless: one-off reads (create-then-read-once).

Default = no cache; serve reads from Postgres. Add a cache to ONE specific endpoint only
when it is a proven read-heavy, staleness-tolerant hot path.
