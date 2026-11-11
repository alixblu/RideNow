# 08 - SQS + EventBridge (async flows)

Goal: create in the console the production bus, queues and rules that the code
already publishes to and consumes from locally. Every service publishes domain events to
one EventBridge bus. One rule per consumer routes only the event types that
consumer handles into its own SQS queue, and each queue has a dead-letter queue (DLQ).

| Queue | Rule matches (`detail-type`) | Consumer | Why |
|-------|------------------------------|----------|-----|
| `ridenow-prod-matching` | `trip.requested` | matching-service | find drivers without blocking `POST /trips` |
| `ridenow-prod-payment` | `trip.completed`, `trip.cancelled` | payment-service | capture / release the hold made at request time |
| `ridenow-prod-notifications` | every `ridenow.*` event | notification-worker | tell the passenger / driver |

Independent of Redis (guide 07), so you can provision either first. The worker's real
delivery path (worker -> Redis -> realtime-gateway -> WebSocket) needs both.

> **IaC path:** stack `05-messaging` creates all of the resources below, including the
> queue policies scoped to each rule. Stack `07-eks-addons` creates the four IRSA
> roles. Use this guide to learn the pieces by hand, or skip it when you
> deploy the stacks.

Time: ~30 min. Cost: SQS and EventBridge cost little at this volume, because you
pay per request.

---

## What the code already expects

The services use the **AWS SDK v2** directly, selected by config:

- **Publishers** (trip-service, payment-service, matching-service) send to the
  bus named by `RIDENOW_EVENTS_BUS_NAME` under the `eventbridge` Spring profile.
  The source is `ridenow.trip`, `ridenow.payment` or `ridenow.matching`, and the
  `DetailType` is the event type.
- **Consumers** each poll their own queue URL: `RIDENOW_MATCHING_QUEUE_URL`,
  `RIDENOW_PAYMENT_QUEUE_URL` and `RIDENOW_NOTIFICATIONS_QUEUE_URL`. A consumer
  deletes a message on success, and the queue's redrive policy dead-letters a
  message that keeps failing.

This mirrors `localstack/init/01-messaging.sh` and `../../iac/stacks/05-messaging.yaml`.

---

## 1. Create the three DLQs (first)

For each of `matching`, `payment` and `notifications`:

1. Console -> **SQS** -> **Create queue** -> **Standard**.
2. Name: `ridenow-prod-<name>-dlq`. Retention: 14 days.
3. **Create queue**. Copy its **ARN**.

## 2. Create the three work queues with redrive -> DLQ

For each of `matching`, `payment` and `notifications`:

1. SQS -> **Create queue** -> **Standard**. Name: `ridenow-prod-<name>`.
2. **Dead-letter queue**: **Enabled**, choose the matching `-dlq`, and set
   **Maximum receives: 5**. This matches the code and the IaC.
3. Visibility timeout: 60s. **Create queue**.
4. Copy each queue **URL**. You need them for the `RIDENOW_*_QUEUE_URL` values in step 6.

## 3. Create the EventBridge bus

1. Console -> **EventBridge** -> **Event buses** -> **Create event bus**.
2. Name: `ridenow-prod-events`. **Create**. This is `RIDENOW_EVENTS_BUS_NAME`.

## 4. Create one rule per queue

EventBridge -> **Rules** -> **Create rule**, on bus `ridenow-prod-events`, rule type
**Rule with an event pattern** -> **Custom pattern (JSON)**:

| Rule name | Pattern | Target |
|-----------|---------|--------|
| `ridenow-prod-trip-requested` | `{"source":[{"prefix":"ridenow."}],"detail-type":["trip.requested"]}` | `ridenow-prod-matching` |
| `ridenow-prod-trip-ended` | `{"source":[{"prefix":"ridenow."}],"detail-type":["trip.completed","trip.cancelled"]}` | `ridenow-prod-payment` |
| `ridenow-prod-all-events` | `{"source":[{"prefix":"ridenow."}]}` | `ridenow-prod-notifications` |

When you pick an SQS target, EventBridge offers to add the queue policy that lets the rule
deliver. To do it by hand, allow `events.amazonaws.com` `sqs:SendMessage` on the
queue ARN, with an `ArnEquals` condition that sets `aws:SourceArn` to the **rule's ARN**.
Then only that rule can write to the queue, not any rule in the account.

---

## 5. Give the pods permission (IRSA)

Each service gets its own policy, scoped to the exact ARNs it uses, and its own IRSA
role trusting only its own Kubernetes service account
(`system:serviceaccount:ridenow:<service>`):

| Service | Permissions |
|---------|-------------|
| trip-service | `events:PutEvents` on the bus |
| payment-service | `events:PutEvents` on the bus; `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` on `ridenow-prod-payment` |
| matching-service | `events:PutEvents` on the bus; the same three SQS actions on `ridenow-prod-matching` |
| notification-worker | the same three SQS actions on `ridenow-prod-notifications` |

Create each role trusting the cluster OIDC provider (guide 05 Part D), then put its ARN
in the service account annotation in `iac/k8s/22-25`. This is how pods get AWS access without static keys.
realtime-gateway needs no AWS access.

## 6. Set the env and roll out

The manifests in `iac/k8s/` already carry these settings. Fill in the placeholders:

```
# trip-service
SPRING_PROFILES_ACTIVE = eventbridge
RIDENOW_EVENTS_BUS_NAME = ridenow-prod-events

# payment-service
SPRING_PROFILES_ACTIVE = eventbridge
RIDENOW_EVENTS_BUS_NAME = ridenow-prod-events
RIDENOW_PAYMENT_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-payment

# matching-service
SPRING_PROFILES_ACTIVE = eventbridge
RIDENOW_EVENTS_BUS_NAME = ridenow-prod-events
RIDENOW_MATCHING_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-matching

# notification-worker
RIDENOW_NOTIFICATIONS_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-notifications
RIDENOW_NOTIFICATIONS_DELIVERY = redis      # deliver through realtime-gateway (needs guide 07)

# all of them
AWS_REGION = ap-southeast-1
# no AWS_ENDPOINT in real AWS (that was the LocalStack override)
```

Then restart:

```bash
kubectl rollout restart deployment/payment-service deployment/trip-service \
  deployment/matching-service deployment/notification-worker -n ridenow
```

> Credentials: with IRSA set up, remove any static `AWS_ACCESS_KEY_ID`/
> `AWS_SECRET_ACCESS_KEY`. The default provider chain picks up the IRSA role
> automatically. Locally you set `test`/`test` for LocalStack, but in AWS you want
> the role.

---

## Verify

- `POST /api/trips` returns `201` with an `estimatedFare`. `GET /api/payments?tripId=`
  shows the payment as `AUTHORIZED`.
- `ridenow-prod-matching` -> **Monitoring** shows one message received, and
  `GET /api/matching/trips/{tripId}/offers` lists offers. Nobody called `/match`.
- Accept -> arrive -> start -> complete the trip. The payment moves to `PAID`
  through `ridenow-prod-payment`, with no HTTP call to payment-service.
- `ridenow-prod-notifications` receives every event. A WebSocket client on `/ws`
  subscribed to `/topic/users/{passengerId}` receives the notifications.
- Force a failure (for example, a malformed message sent to a queue by hand) and watch it land in
  that queue's `-dlq` after 5 receives.

## Clean up

SQS and EventBridge cost little, but to tidy up, delete the three rules, then the bus,
then all six queues. Remove the env vars (or the `eventbridge` profile) and the services
fall back to the logging publisher, while the consumers stay off.
