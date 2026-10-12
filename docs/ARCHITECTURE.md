# RideNow Architecture - The Local-First Mental Model

This document explains how RideNow is *meant* to be understood and built: as a set of
stable boundaries, where each boundary starts with the simplest possible mechanism and is
later swapped for its "real" counterpart. Nothing here replaces the proposal
(`RideNow_Project_Proposal.md`) or the step list (`LEARNING_PATH.md`) - it is the mental
model that makes both of them click, and makes the eventual cloud migration feel boring.

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

The hard part of these services is the *concept*, not the vendor. Learn the concept with
the simplest local mechanism first, then move to the AWS service - the ideas carry over
directly.

**Message queue (outbox-on-Postgres -> SQS).** The concept is: a producer hands off a
message; a worker consumes it later; failures are retried; messages that keep failing go
to a dead-letter queue; consumers must be idempotent (processing the same message twice
must not double-charge anyone). Learn this locally with an **outbox table + poller** using
only the Postgres you already run - no message broker to install. SQS is the same concept
with AWS running the queue. Migration is mostly swapping the implementation behind your
`NotificationPublisher` interface. (RabbitMQ is a popular standalone broker, but it is NOT
part of this project - the outbox gives you the same lessons with one less tool, and SQS
is the actual destination.)

**Kubernetes (local -> EKS).** The concept is: describe your app as a Deployment (how many
replicas, which image, probes, resources); Kubernetes keeps it running and routes traffic
via a Service. Learn that with Docker Desktop's built-in Kubernetes or `kind` (free, on
your laptop). EKS is the same Kubernetes with AWS running the control plane and nodes. Your
YAML manifests are ~90% the same.

**But not yet.** Do not install a message broker or Kubernetes now. You have no feature that needs
them. Introduce each only when a concrete feature creates the problem it solves:
- Notifications feature -> now you need async messaging -> introduce the outbox, then SQS.
- "The system must stay up and scale" -> now you need orchestration -> introduce local k8s.

Learning a solution before you have its problem is the exact trap the proposal warns about.

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