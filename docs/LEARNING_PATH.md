# RideNow Learning Path & Checklist

A step-by-step path from "one service on my laptop" to "cloud-native microservices on AWS EKS".

Follow it top to bottom. Do not skip ahead. Each stage ends with a **Definition of Done**
you can verify before moving on. The golden rule from the proposal:

> Build the smallest end-to-end ride flow first. Add complexity only when the previous
> version works and the next engineering problem gives you a reason to introduce it.

Legend: `[ ]` not started  `[~]` in progress  `[x]` done

Companion docs:
- `ARCHITECTURE.md` - the local-first mental model (boundaries vs mechanisms)
- `PLAN_LOCAL_VS_CLOUD.md` - service/technique/problem mapping, diagrams, and the concurrency lab
- `guides/` - detailed step-by-step walkthroughs per stage

---

## How to use this document

- Work one **stage** at a time. A stage is only "done" when its Definition of Done passes.
- Each step says **what** to do, **why** it matters, and **how to verify** it.
- When you finish a step, change its `[ ]` to `[x]`.
- Prefer understanding over speed. If you cannot explain *why* a step exists, revisit it.

---

# PART 1 - LOCAL MICROSERVICES FOUNDATION

No cloud yet. Everything runs on your laptop. This part teaches what a microservice IS.

## Stage 0 - Environment ready

- [x] Docker Desktop installed and daemon running (`docker info`)
- [x] JDK 25 installed (`java -version`)
- [x] Maven wrapper works in a service (`.\mvnw.cmd -version`)
- [ ] You can open the repo in your IDE and see all service folders

**Definition of Done:** all four checks above pass.

---

## Stage 1 - One microservice, running end-to-end (driver-service)  [DONE]

Goal: a single service that boots, talks to its own database, and completes a
create-then-read loop over HTTP.

- [x] Understand the layered structure: controller -> service -> repository -> entity
- [x] Run a dedicated PostgreSQL for driver-service via `docker-compose.yml`
- [x] Wire `application.yaml` to the database; app boots and connects
- [x] Add the write path: `POST /api/drivers` with a validated request DTO
- [x] Verify end-to-end: POST creates (201), GET reads back (200), row exists in Postgres
- [x] Service tests pass (`.\mvnw.cmd test`)

**Definition of Done:** you can create a driver with curl/PowerShell and read it back,
and you can explain why the controller returns a DTO instead of the entity.

**Concepts you should now be able to explain:**
- Why each service owns its own database
- Why `userId` is stored as a plain UUID, not a JPA relationship to a User entity
- What a connection pool is and why it exists
- The difference between a request DTO, an entity, and a response DTO

---

## Stage 2 - Finish driver-service's own domain

Goal: make driver-service genuinely useful at its own boundary before adding more services.

- [ ] Add `POST /api/drivers/{driverId}/vehicles` to register a vehicle for a driver
- [ ] Add `GET /api/drivers/{driverId}/vehicles` to list a driver's vehicles
- [ ] Add driver status change: `PATCH /api/drivers/{id}/status` (ACTIVE <-> SUSPENDED)
- [ ] Validate all request DTOs; return 400 on bad input, 404 on missing driver
- [ ] Write unit tests for the service rules (duplicate plate, unknown driver, etc.)

**Definition of Done:** a driver and their vehicle(s) can be created and listed; invalid
input is rejected with clear errors; tests cover the rules.

---

## Stage 3 - A second service (user-service)

Goal: repeat the Stage 1 pattern on a fresh service so the structure becomes muscle memory.

- [ ] Create the layered packages: controller, dto, service, repository, entity, exception
- [ ] Model the `users` table from the DBML as a `User` entity
- [ ] Add its own `docker-compose.yml` Postgres on a DIFFERENT host port (e.g. 5434)
- [ ] Wire `application.yaml`; run it on a DIFFERENT server port (e.g. 8081)
- [ ] Add `POST /api/users` and `GET /api/users/{id}`
- [ ] Verify end-to-end just like Stage 1

**Definition of Done:** two services run at the same time on different ports, each with
its own database, each independently startable.

---

## Stage 4 - Service-to-service communication

Goal: feel a real microservice boundary. driver-service needs user info it does not own.

- [ ] Decide the contract: when creating a driver, verify the `userId` exists in user-service
- [ ] Add an HTTP client in driver-service that calls `GET /api/users/{id}` on user-service
- [ ] Handle the failure cases: user not found (reject driver creation), user-service down (fail clearly)
- [ ] Make the user-service base URL a configuration value, not a hardcoded string
- [ ] Observe: what happens to driver-service if user-service is stopped?

**Definition of Done:** creating a driver with a non-existent userId is rejected because
driver-service asked user-service; you can explain why this is a call, not a database join.

**Concepts:** service contracts, network failure as a first-class concern, timeouts,
why cross-service joins are forbidden.

---

# PART 1B - THE RIDE FLOW (local core, still no cloud)

This is the heart of the project and runs entirely on Postgres you already have.
See `PLAN_LOCAL_VS_CLOUD.md` for the service/technique/problem mapping and diagrams,
and `ARCHITECTURE.md` for the local-first mental model.

## Stage 4A - Trip lifecycle (trip-service)

Goal: model a trip as a state machine with real transactions. No queue, no Redis.

- [ ] Build trip-service like the others (own DB, own port) from the DBML `trips` table
- [ ] `POST /api/trips` creates a trip in status REQUESTED
- [ ] Model valid transitions: REQUESTED -> SEARCHING -> DRIVER_ASSIGNED -> DRIVER_ARRIVED -> IN_PROGRESS -> COMPLETED (and CANCELLED)
- [ ] Reject invalid transitions (e.g. COMPLETED -> REQUESTED) with a clear error
- [ ] Store cross-service refs (passengerId, driverId) as plain UUIDs

**Definition of Done:** a trip moves through its states via the API; illegal jumps are rejected.

## Stage 4B - The concurrency lab (THE signature problem)  [BUILT & VERIFIED]

Goal: two drivers accept the same ride; prove exactly one wins. Pure Postgres + JPA.
Full explanation and diagrams: `PLAN_LOCAL_VS_CLOUD.md` section 3.
Detailed walkthrough + how to re-run the proof: `guides/stage-04b-concurrency-lab.md`.

- [x] Add a `@Version` field to the Trip entity (optimistic locking)
- [x] Implement accept-ride as ONE `@Transactional` method in trip-service
- [x] Translate the version conflict into a clean "ride no longer available" response
- [x] Write a concurrency test: fire many simultaneous accepts, assert exactly one succeeds
- [ ] (Optional) Try pessimistic locking (`FOR UPDATE`) and compare behavior

**Definition of Done:** MET - the test proves exactly one of 50 simultaneous accepts wins
(`WINNERS=1 LOSERS=49`), and the DB shows a single assignment. This same code works
unchanged on RDS later.

## Stage 4C - Matching, the boring way first (matching-service)

Goal: find a nearby driver with a plain Postgres query; feel its limits before Redis.

- [ ] matching-service proposes candidate drivers; trip-service still owns the accept write
- [ ] Query available drivers (naive distance is fine at first)
- [ ] Note what is slow/awkward - this is the motivation for Redis GEO later (Stage 11)

**Definition of Done:** a trip can be matched to a candidate driver using only Postgres.

## Stage 4D - Async notifications, the local way (outbox pattern)

Goal: send notifications without blocking the trip and without losing them on a crash -
using ONLY Postgres. This is the local stand-in for SQS. No message broker, no RabbitMQ.

- [ ] Add an `outbox` table; write an outbox row in the SAME transaction as the trip change
- [ ] A scheduled poller reads unsent rows and hands them to notification-worker
- [ ] Mark rows sent; retry failures; understand idempotent consumption
- [ ] Observe why this is safe even if the app crashes mid-way (no dual-write problem)

**Definition of Done:** completing a trip reliably produces a notification via the outbox,
and you can explain how this maps directly onto SQS + DLQ in the cloud (Stage 11).

## Stage 4E - Payment with idempotency (payment-service)

Goal: charge once; a retried request must not double-charge.

- [ ] `POST /api/payments` with an idempotency key (DBML `payments.idempotency_key`)
- [ ] A duplicate request with the same key returns the original result, no second charge
- [ ] Model PENDING -> PROCESSING -> PAID / FAILED; handle failure with explicit state
- [ ] On failure, the trip is reconciled by compensation (the Saga idea), not a cross-service transaction

**Definition of Done:** paying twice with the same key charges once; failures leave consistent state.

---
# PART 2 - CONTAINERIZATION (the bridge to the cloud)

Now package the services themselves as containers, not just their databases.

## Stage 5 - Containerize one service

- [ ] Write a `Dockerfile` for driver-service (multi-stage: build with Maven, run on JRE)
- [ ] Build the image (`docker build`) and run the container locally
- [ ] Connect the containerized app to its Postgres (container networking, not localhost)
- [ ] Verify the same create/read loop works against the containerized service

**Definition of Done:** driver-service runs as a container image and still passes its
end-to-end loop.

## Stage 6 - Run the whole local system with Compose

- [ ] Extend compose to run app + database together as one `docker compose up`
- [ ] Add healthchecks and startup ordering (app waits for DB healthy)
- [ ] Bring up driver-service + user-service + their DBs together

**Definition of Done:** `docker compose up` starts the local system; `down` stops it cleanly.

---

# PART 3 - AWS, CONSOLE FIRST

Learn each AWS resource by clicking through the Console once, THEN reproduce it with
CloudFormation. Do these in order - later resources depend on earlier ones.

> Cost note: most of this fits in free tier if you stop/delete resources when not using
> them. Always tear down at the end of a session. Never leave an EKS cluster or RDS
> instance running overnight by accident.

## Stage 7 - Account & identity (IAM)

- [ ] Create/secure an AWS account; enable MFA on the root user
- [ ] Create an admin IAM user (or Identity Center user) for daily use; stop using root
- [ ] Install and configure the AWS CLI (`aws configure`) with that user
- [ ] Console: explore IAM users, roles, and policies; understand least privilege

**Definition of Done:** you can run `aws sts get-caller-identity` as a non-root user.

## Stage 8 - Networking (VPC)

- [ ] Console: look at the default VPC - subnets, route tables, internet gateway
- [ ] Understand public vs private subnets and security groups
- [ ] Create a security group that will later allow your app to reach a database

**Definition of Done:** you can explain, in your own words, how traffic reaches a
resource inside a VPC and what a security group controls.

## Stage 9 - Managed database (RDS PostgreSQL)

- [ ] Console: create a small RDS PostgreSQL instance (free-tier size)
- [ ] Put it in the right subnets; attach the security group from Stage 8
- [ ] Connect to it from your laptop with psql to confirm access
- [ ] Point a local driver-service at RDS instead of the local Postgres and run the loop
- [ ] CloudFormation: write a template that recreates this RDS instance; deploy it
- [ ] Delete the console-made instance; keep only the CloudFormation-made one

**Definition of Done:** driver-service runs against RDS, and you can create/destroy that
RDS instance from a CloudFormation template.

## Stage 10 - Image registry (ECR)

- [ ] Console: create an ECR repository for driver-service
- [ ] Authenticate Docker to ECR, push your Stage 5 image
- [ ] CloudFormation: define the ECR repository as code

**Definition of Done:** your driver-service image is in ECR and pullable.

## Stage 11 - Distributed-systems building blocks (introduce only when needed)

Do these as the matching/notification/payment features actually require them.

- [ ] ElastiCache for Redis - driver location, GEO lookup, shared state
- [ ] SQS - async notification jobs, retries, dead-letter queue
- [ ] EventBridge - publish trip events to independent consumers
- [ ] Secrets Manager - move database credentials out of config files

**Definition of Done:** each service is introduced because a feature needed it, and you
can name the backend problem it solves.

---

# PART 4 - KUBERNETES ON EKS

Only after services run as containers and you understand the AWS basics.

## Stage 12 - A cluster and your first Pod

- [ ] Console: create an EKS cluster (smallest viable node group)
- [ ] Install `kubectl` and connect to the cluster
- [ ] Deploy driver-service as a Deployment + Service pulling its image from ECR
- [ ] Add readiness/liveness probes using the actuator health endpoint

**Definition of Done:** driver-service runs in a Pod on EKS and serves traffic inside the cluster.

## Stage 13 - Routing, config, scaling, hardening

- [ ] Ingress/ALB to route external HTTP to the service
- [ ] ConfigMap for non-secret config; Secret (or Secrets Manager) for credentials
- [ ] Horizontal Pod Autoscaler (HPA) driven by CPU/metrics
- [ ] Resource requests/limits on every container
- [ ] CloudFormation (or eksctl) to make the cluster reproducible

**Definition of Done:** the service scales under load, recovers failed Pods, and the
cluster can be recreated from code.

---

# PART 5 - OBSERVABILITY, CI/CD, TESTING

- [ ] CloudWatch logs and metrics; a dashboard for request errors
- [ ] Replace `ddl-auto` with Flyway migrations (versioned SQL) in every service
- [ ] Replace DB-dependent `@SpringBootTest` with Testcontainers
- [ ] The signature concurrency lab: prove exactly one driver wins a race for a ride
- [ ] CI/CD pipeline: test -> build image -> push to ECR -> deploy to EKS
- [ ] Load test with k6; document latency, throughput, and scaling behavior
- [ ] Failure testing: kill Pods, stop workers, duplicate messages; document recovery

**Definition of Done:** matches the proposal's Definition of Done table in section 15.

---

## Deferred by design (do NOT build early)

Per the project rules, these are later goals, not prerequisites. Introduce the smallest
version only when a feature needs it:
Redis, SQS, EventBridge, WebSockets, Saga orchestration, Kubernetes, AWS infrastructure.

## Known shortcuts to repay later

- `ddl-auto: update` is a learning shortcut -> replace with Flyway (Stage/Part 5)
- DB-dependent `@SpringBootTest` -> replace with Testcontainers (Part 5)