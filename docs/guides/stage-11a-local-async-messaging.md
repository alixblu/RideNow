# Stage 11A - Local async messaging (SQS + EventBridge on LocalStack)

> Part: PART 1B - RIDE FLOW (backend code), the async-notifications slice.
> Scope: BACKEND CODE + local infrastructure. This is the local-first build of the
> messaging boundary; the AWS console version is Stage 11. The code here is written
> against the real AWS SDK v2 and exercised against LocalStack, so the swap to real
> AWS later is config-only (drop `AWS_ENDPOINT`, supply real creds/region).

## What this slice builds

The async-notifications flow from `../ARCHITECTURE.md` (§3, §8), made real locally:

```
trip-service    --(EventBridge: trip.completed / trip.cancelled / driver.accepted / driver.arrived)--┐
payment-service --(EventBridge: payment.succeeded / payment.failed)----------------------------------┤
                                                                                                      v
                                                                                  ridenow-local-events bus
                                                                                         | rule: source prefix "ridenow."
                                                                                         v
                                                SQS ridenow-local-notifications (+ DLQ, maxReceiveCount 5)
                                                                                         |
                                                                                         v
                                         notification-worker (idempotent consumer, retry, DLQ)
```

- **EventBridge = fan-out** (one event, many possible consumers).
- **SQS = durable work queue** feeding one consumer group, with a dead-letter queue.
- These are the two tools doing their one job each, exactly as the architecture decides.

## The boundaries (what is swappable)

| Boundary | Behind the interface | Local mechanism | Cloud mechanism |
|----------|----------------------|-----------------|-----------------|
| Publish a domain event | `DomainEventPublisher` | `LoggingDomainEventPublisher` (default) | `EventBridgeDomainEventPublisher` (profile `eventbridge`) |
| AWS endpoint | `AWS_ENDPOINT` env | `http://localstack:4566` | unset (real AWS) |
| Credentials | `AWS_ACCESS_KEY_ID/SECRET` env | `test`/`test` (LocalStack) | IAM role / real creds |
| Deliver a notification | `NotificationSender` | `LoggingNotificationSender` | real provider later |

Business code (trip/payment services) only ever calls `events.publishEvent(...)`. The
publish happens **after the DB transaction commits** (a `@TransactionalEventListener`
bound to `AFTER_COMMIT`), so a rolled-back change publishes nothing and a transport
failure never undoes committed business state.

## Resource names (match the cloud)

The LocalStack init script (`localstack/init/01-messaging.sh`) creates the same names
`iac/stacks/05-messaging.yaml` uses, with `local` as the environment:

- EventBridge bus: `ridenow-local-events`
- SQS queue: `ridenow-local-notifications`
- SQS DLQ: `ridenow-local-notifications-dlq` (redrive, `maxReceiveCount=5`)
- Rule: matches `{"source":[{"prefix":"ridenow."}]}` -> targets the queue

## Run it locally

```bash
cp .env.example .env            # once
docker compose up --build       # whole system + LocalStack + notification-worker
```

Compose starts LocalStack, runs the init script, then starts the services with
`AWS_ENDPOINT=http://localstack:4566` and `SPRING_PROFILES_ACTIVE=eventbridge`.

### Observe the flow

1. Create and drive a trip (ports: trip-service 8082):

   ```bash
   # create a trip (returns an id)
   curl -s -X POST localhost:8082/api/trips -H 'content-type: application/json' \
     -d '{"passengerId":"11111111-1111-1111-1111-111111111111","rideType":"CAR",
          "pickupLat":10.0,"pickupLng":106.0,"destinationLat":10.1,"destinationLng":106.1}'

   # accept -> arrive -> start -> complete (driver.accepted, driver.arrived, trip.completed)
   curl -s -X POST "localhost:8082/api/trips/<ID>/accept?driverId=22222222-2222-2222-2222-222222222222"
   curl -s -X POST localhost:8082/api/trips/<ID>/arrive
   curl -s -X POST localhost:8082/api/trips/<ID>/start
   curl -s -X POST localhost:8082/api/trips/<ID>/complete
   ```

2. Charge a payment (payment-service 8083) to emit `payment.succeeded` / `payment.failed`.

3. Watch notification-worker log one `notification sent` line per event:

   ```bash
   docker compose logs -f notification-worker
   ```

### Inspect the queue directly (optional)

```bash
docker compose exec localstack awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/ridenow-local-notifications \
  --attribute-names ApproximateNumberOfMessages --region ap-southeast-1
```

## Retry + DLQ

If a notification keeps failing, the worker does NOT delete the message; SQS makes it
visible again and redelivers it, and after `maxReceiveCount` deliveries the message lands
in `ridenow-local-notifications-dlq`. The idempotency ledger (`processed_notifications`,
keyed by event id) means a duplicate delivery is a no-op, so no one is notified twice.

## Verify (Definition of Done)

- [ ] `docker compose up` starts all services + LocalStack with the bus, queue, DLQ, and rule provisioned.
- [ ] Driving a trip and charging a payment produces events that reach the SQS queue via the rule.
- [ ] notification-worker processes each event exactly once (duplicate delivery is a no-op).
- [ ] A repeatedly failing message ends up in the DLQ.

Automated coverage lives in:
- `trip-service` / `payment-service`: `EventBridgeToSqsIntegrationTest` (publish -> rule -> queue).
- `notification-worker`: `NotificationWorkerIntegrationTest` (consume once, idempotency, DLQ).

## When you reach Stage 11 (AWS console)

Everything above is the same, minus LocalStack: create the bus/queue/DLQ/rule in the
console, drop `AWS_ENDPOINT`, and give each service real credentials (an IAM role on EKS).
No application code changes - that is the whole point of the local-first build.
