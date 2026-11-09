# 08 - SQS + EventBridge (async notifications)

Goal: the production bus/queue/rule the code already publishes to and consumes
from locally, created in the console. trip/payment events fan out through
EventBridge to an SQS queue, and notification-worker processes them with retries
+ DLQ.

Independent of Redis (guide 07) — provision in either order.

Time: ~20 min. Cost: SQS/EventBridge are inexpensive at this volume (pay per
request).

---

## What the code already expects

The built services use the **AWS SDK v2** directly, selected by config:

- trip-service / payment-service publish to an **EventBridge bus** named by
  `RIDENOW_EVENTS_BUS_NAME` (local default `ridenow-local-events`), Source
  `ridenow.trip` / `ridenow.payment`, under the `eventbridge` Spring profile.
- notification-worker polls an **SQS queue** given by
  `RIDENOW_NOTIFICATIONS_QUEUE_URL`, deletes on success, and relies on the
  queue's redrive policy to dead-letter poison messages.

So this guide is: create those resources in the console (use the **cloud** names
`ridenow-prod-*` or whatever env you pick), then set the env vars. This mirrors
`localstack/init/01-messaging.sh` and the gated `../../iac/stacks/05-messaging.yaml`.

---

## 1. Create the dead-letter queue (first)

1. Console -> **SQS** -> **Create queue**.
2. Type **Standard**. Name: `ridenow-prod-notifications-dlq`.
3. Leave defaults. **Create queue**. Copy its **ARN**.

## 2. Create the work queue with redrive -> DLQ

1. SQS -> **Create queue** -> **Standard**. Name: `ridenow-prod-notifications`.
2. **Dead-letter queue**: **Enabled** -> choose `...-dlq` by ARN -> **Maximum
   receives: 5** (matches the code's expectation and the IaC).
3. Visibility timeout: 60s is fine. **Create queue**.
4. Copy the work queue's **URL** (this is `RIDENOW_NOTIFICATIONS_QUEUE_URL`).

## 3. Create the EventBridge bus

1. Console -> **EventBridge** -> **Event buses** -> **Create event bus**.
2. Name: `ridenow-prod-events`. **Create**. (This is `RIDENOW_EVENTS_BUS_NAME`.)

## 4. Create a rule: all RideNow events -> the queue

1. EventBridge -> **Rules** -> **Create rule**.
2. Name: `ridenow-prod-all-events`. **Event bus**: `ridenow-prod-events`.
3. Rule type: **Rule with an event pattern**.
4. Event pattern -> **Custom pattern (JSON)**:

   ```json
   { "source": [ { "prefix": "ridenow." } ] }
   ```

   (Matches both `ridenow.trip` and `ridenow.payment`.)
5. **Target**: **SQS queue** -> `ridenow-prod-notifications`.
6. **Create**. EventBridge adds the queue policy that lets it deliver; if not,
   add an SQS access policy allowing `events.amazonaws.com` `sqs:SendMessage` to
   the queue ARN (the LocalStack init script does exactly this).

---

## 5. Give the pods permission (IRSA)

- **trip-service / payment-service** need `events:PutEvents` on the bus ARN.
- **notification-worker** needs `sqs:ReceiveMessage/DeleteMessage/
  GetQueueAttributes` on the queue ARN.

For each, create an IAM policy scoped to that ARN, create an IRSA role trusting
the cluster OIDC provider (guide 05 Part D) for that service's Kubernetes service
account, and annotate the service account with the role ARN. This is how pods get
AWS access without static keys.

## 6. Set the env and roll out

On **trip-service** and **payment-service**:

```
SPRING_PROFILES_ACTIVE = eventbridge
RIDENOW_EVENTS_BUS_NAME = ridenow-prod-events
AWS_REGION = ap-southeast-1
# no AWS_ENDPOINT in real AWS (that was the LocalStack override)
```

On **notification-worker**:

```
RIDENOW_NOTIFICATIONS_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-notifications
AWS_REGION = ap-southeast-1
```

Then restart:

```bash
kubectl rollout restart deployment/trip-service deployment/payment-service deployment/notification-worker -n ridenow
```

> Credentials: with IRSA set, drop any static `AWS_ACCESS_KEY_ID`/
> `AWS_SECRET_ACCESS_KEY` - the default provider chain picks up the IRSA role
> automatically. (Locally you set `test`/`test` for LocalStack; in AWS you want
> the role.)

---

## Verify

- Drive a trip (accept -> arrive -> complete) and charge a payment via the ALB.
- SQS console -> `ridenow-prod-notifications` -> **Monitoring** shows messages
  received; notification-worker logs one "notification sent" per event.
- Force a failure (e.g. a bad message) and watch it land in
  `ridenow-prod-notifications-dlq` after 5 receives.

## Clean up

SQS/EventBridge cost little, but to tidy up: delete the rule, the bus, then both
queues. Remove the env vars (or the `eventbridge` profile) so the services fall
back to the logging publisher and the worker idles.
