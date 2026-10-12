# RideNow - Local Plan vs Cloud Plan

For every capability in the system this document answers four things:

1. **Service** - which microservice owns it
2. **Problem** - the backend problem it has to solve
3. **Local technique** - how you solve it on your laptop first (the lesson)
4. **Cloud technique** - what it becomes on AWS (the same concept, managed)

The boundaries never change between local and cloud. Only the mechanism changes.

---

## 1. Capability map (service / problem / local / cloud)

| Capability            | Service              | Problem it solves                                   | Local technique (build first)                     | Cloud technique (migrate to)              |
|-----------------------|----------------------|-----------------------------------------------------|---------------------------------------------------|-------------------------------------------|
| Accounts & login      | user-service         | Who is this person? Is the login valid?             | Spring Security + password hash; users in Postgres| Same code; (optional) AWS Cognito identity |
| Driver profiles       | driver-service       | Driver identity, vehicles, ACTIVE/SUSPENDED         | JPA + Postgres; validated DTOs                     | Same code; RDS PostgreSQL                 |
| Request a ride        | trip-service         | Create a trip, model its lifecycle correctly        | State machine in code + transactions (Postgres)    | Same code; RDS PostgreSQL                 |
| **Accept a ride**     | **trip-service**     | **Two drivers accept the same ride - exactly one may win** | **DB transaction + optimistic/pessimistic lock** | **Same code; RDS (locks work identically)** |
| Find a nearby driver  | matching-service     | Which available drivers are closest?                | Plain Postgres query over driver locations         | Redis GEO (ElastiCache)                   |
| Live driver location  | driver-service       | Fast-changing position, shared, not durable         | A column in Postgres, rider polls over HTTP        | Redis (shared state) + WebSockets         |
| Notify people         | notification-worker  | Send async without blocking the trip; survive crashes | Outbox table + scheduled poller (Postgres only)  | SQS queue + worker + dead-letter queue    |
| React to trip events  | (consumers)          | Other services react without tight coupling         | Read outbox / direct call                          | EventBridge                               |
| Take payment          | payment-service      | Charge once; retries must not double-charge         | Idempotency key + explicit status in Postgres      | Same code; RDS; (events via SQS/EventBridge) |
| Payment can fail      | payment + trip       | A failed charge must not leave an inconsistent trip | Explicit states + compensation (Saga, in code)     | Same, coordinated via events              |
| Run the services      | all                  | Keep them alive, scale, route traffic               | `mvn spring-boot:run`, then Docker, then local k8s | Amazon EKS (managed Kubernetes)           |
| Store images          | all                  | Versioned, deployable artifacts                     | `docker build` (local image)                       | Amazon ECR                                |
| Config & secrets      | all                  | Configure per environment; protect credentials      | `application.yaml`                                 | ConfigMap/Secret -> AWS Secrets Manager   |
| See what happened     | all                  | Logs/metrics to investigate failures                | Console logs, actuator                             | CloudWatch logs, metrics, alarms          |

The one row in bold is the heart of the whole project. Everything else is supporting cast.
Section 3 explains it in detail.

---

## 2. The two system pictures

### Local plan (your laptop - no AWS, no broker, no Kubernetes)

```text
                 HTTP (REST)
 Passenger app  ------------------>  +----------------+
 Driver app     ------------------>  |  Spring Boot   |   each service is just
                                     |  services:     |   `mvn spring-boot:run`
                                     |  user / driver |
                                     |  trip / match  |
                                     |  payment       |
                                     +--------+-------+
                                              |
                      each service owns its OWN Postgres container
                                              |
             +----------+   +----------+   +----------+   +-----------+
             | user-db  |   | driver-db|   | trip-db  |   | payment-db|   (Docker)
             +----------+   +----------+   +----------+   +-----------+

 Async notifications (local):
   trip-service writes an "outbox" row in trip-db  (same transaction as the trip change)
        |
        v
   a scheduled poller reads unsent outbox rows --> calls notification-worker --> marks sent

 Everything above runs with Docker + Maven. Nothing cloud. Nothing to pay for.
```

### Cloud plan (AWS - same boundaries, managed mechanisms)

```text
 Passenger/Driver app
        |
        v  HTTPS
 +--------------+        +---------------------------- Amazon EKS -----------------------------+
 | ALB /Ingress | -----> |  Pods: user / driver / trip / matching / payment  (images from ECR) |
 +--------------+        +----+-------------------+-----------------+-------------------+-------+
                              |                   |                 |                   |
                              v                   v                 v                   v
                        RDS PostgreSQL      ElastiCache Redis     SQS queue        Secrets Manager
                        (one DB per svc)    (GEO + live state)   (+ DLQ)           (credentials)
                                                                   |
                                                                   v
                                                         notification-worker Pod
                                                                   |
                                                                   v
                                                         CloudWatch (logs, metrics, alarms)

 Outbox rows are now published to SQS; the worker consumes them; failures land in a DLQ.
 Business code barely changes - only the NotificationPublisher implementation swaps.
```

Notice what is identical in both pictures: the services, who owns which data, and who talks
to whom. What changed: Postgres container -> RDS, poller -> SQS, in-code state -> Redis,
`mvn run` -> EKS Pods. That is the "easy migration" payoff.

---

## 3. The concurrency problem (the signature lesson)

### The problem, in plain terms

One ride request can be shown to several nearby drivers at once. If two drivers tap
**Accept** at nearly the same moment, the system must guarantee **exactly one winner**.
If you get this wrong, two drivers both think they got the ride.

### Why the naive approach is broken

```text
Driver A thread                     Driver B thread
---------------                     ---------------
SELECT trip  (status = SEARCHING)
                                    SELECT trip  (status = SEARCHING)   <-- both see "free"
check: free? yes
                                    check: free? yes                    <-- both think they won
UPDATE trip SET driver = A
                                    UPDATE trip SET driver = B           <-- B overwrites A
COMMIT
                                    COMMIT

Result: BOTH succeeded. The ride was given away twice. BUG.
```

The gap is between "read the status" and "write the assignment". Two requests can both read
the old value before either writes. This is a **race condition**.

### Fix option 1 - Optimistic locking (the recommended default)

Each trip row has a `version` number (your DBML already has `version bigint` on `trips`).
An update only succeeds if the version is still what you read. Exactly one update can win;
the other sees "version changed" and is rejected.

```text
Driver A                                  Driver B
--------                                  --------
read trip (version = 7)                   read trip (version = 7)
UPDATE ... SET driver=A, version=8
   WHERE id=? AND version=7   -> 1 row     UPDATE ... SET driver=B, version=8
COMMIT  (A WINS)                              WHERE id=? AND version=7 -> 0 rows (!)
                                           0 rows updated -> rejected -> B is told
                                           "ride no longer available"  (B LOSES, cleanly)
```

In Spring/JPA this is just a `@Version` field on the Trip entity. When two commits collide,
JPA throws `OptimisticLockException`, which you translate into a clean "already taken"
response. No locks held, great under load, perfect for "many drivers, one ride".

### Fix option 2 - Pessimistic locking (when you want to serialize)

Lock the row while you decide, so the second request waits.

```text
Driver A                                  Driver B
--------                                  --------
SELECT ... FOR UPDATE   (locks the row)
                                          SELECT ... FOR UPDATE   -> BLOCKS, waits for A
check free? yes
UPDATE SET driver = A
COMMIT  (lock released, A WINS)
                                          ...now proceeds, sees driver already = A
                                          -> rejected cleanly  (B LOSES)
```

In Spring Data: `@Lock(LockModeType.PESSIMISTIC_WRITE)` on the finder. Simpler to reason
about, but holds a lock and can reduce throughput under heavy contention.

### Which to use, and where it lives

- **Default: optimistic locking** via the `version` column. It fits "lots of drivers see
  one ride" far better - no blocking, scales well.
- **Where the write happens: trip-service**, in a single `@Transactional` method against a
  single database. This is the key architectural decision: keep the accept-ride write
  inside ONE service and ONE database, so the lock actually protects it. matching-service
  only *proposes* candidate drivers; it does not perform the winning write.

### Local vs cloud for concurrency

Here is the reassuring part: **nothing about this changes in the cloud.** The transaction,
the `@Version` field, the `FOR UPDATE` lock - they are features of PostgreSQL and JPA. They
behave the same on your local Postgres container and on Amazon RDS. You solve the signature
problem once, locally, and it just works when you migrate. No SQS, no Redis, no EKS needed
to get it right.

(Later, IF matching coordination must span beyond one database, a Redis distributed lock
becomes relevant - but that is an advanced extension, not the core solution.)

---

## 4. Order to build it (so each technique has a reason to exist)

1. Two-service HTTP system (Stages 1-4) - you are here.
2. trip-service: trip lifecycle state machine (transactions).
3. **Accept-ride concurrency lab** - optimistic locking, prove one winner. Pure Postgres.
4. matching-service: Postgres query first; feel the limits; then Redis GEO.
5. Notifications: outbox + poller (Postgres); later publish to SQS + DLQ.
6. Payment: idempotency key + explicit states; failure handled by compensation.
7. Containerize -> local Kubernetes -> AWS (RDS, ECR, ElastiCache, SQS) -> EKS.

Each step introduces a technique only when the previous step created the problem it solves.