# 08 - SQS + SNS (async flows)

Goal: create in the console the production topic, queues and subscriptions that the code
already publishes to and consumes from locally. Every service publishes domain events to
one SNS topic. One subscription per consumer delivers only the event types that
consumer handles into its own SQS queue, and each queue has a dead-letter queue (DLQ).

| Queue | Subscription filter (`type`) | Consumer | Why |
|-------|------------------------------|----------|-----|
| `ridenow-prod-matching` | `trip.requested` | matching-service | find drivers without blocking `POST /trips` |
| `ridenow-prod-payment` | `trip.completed`, `trip.cancelled` | payment-service | capture / release the hold made at request time |
| `ridenow-prod-notifications` | none (every event) | notification-worker | tell the passenger / driver |

Independent of Redis (guide 07), so you can provision either first. The worker writes
notifications to its inbox table; it also needs Redis (guide 07) for the trip tracking
pairing that realtime-gateway reads.

> **IaC path:** stack `05-messaging` creates all of the resources below, including the
> queue policies scoped to the topic. Stack `07-eks-addons` creates the four IRSA
> roles. Use this guide to learn the pieces by hand, or skip it when you
> deploy the stacks.

Time: ~30 min. Cost: SNS and SQS cost little at this volume, because you
pay per request.

---

## What the code already expects

The services use the **AWS SDK v2** directly, selected by config:

- **Publishers** (trip-service, payment-service, matching-service) publish to the
  topic whose ARN is in `RIDENOW_EVENTS_TOPIC_ARN` under the `sns` Spring profile. The
  message body is the event JSON. It carries a top-level `type` field (for example
  `trip.completed`), and the subscription filters match on it. Publishers set no message
  attributes.
- **Consumers** each poll their own queue URL: `RIDENOW_MATCHING_QUEUE_URL`,
  `RIDENOW_PAYMENT_QUEUE_URL` and `RIDENOW_NOTIFICATIONS_QUEUE_URL`. The subscriptions use
  raw message delivery, so each queue body is the event JSON itself, with no SNS
  envelope. A consumer deletes a message on success, and the queue's redrive policy
  dead-letters a message that keeps failing.

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

## 3. Create the SNS topic

1. Console -> **SNS** -> **Topics** -> **Create topic** -> **Standard**.
2. Name: `ridenow-prod-events`. Leave **Encryption** off for now (see the note below).
   **Create topic**.
3. Copy the topic **ARN**. This is `RIDENOW_EVENTS_TOPIC_ARN`.

> **Encryption note:** do not turn on encryption with the AWS-managed `aws/sns` key. SNS
> cannot deliver to SQS subscriptions from a topic encrypted with that key, because its
> key policy cannot be edited to allow the SNS service. To encrypt at rest, use a
> customer-managed KMS key whose policy allows `sns.amazonaws.com`.

## 4. Create one subscription per queue

SNS -> **Subscriptions** -> **Create subscription**, topic `ridenow-prod-events`,
protocol **Amazon SQS**, endpoint = the queue ARN. Then open **Subscription filter policy**
and **Raw message delivery**:

| Queue | Raw message delivery | Filter policy scope | Filter policy |
|-------|----------------------|---------------------|---------------|
| `ridenow-prod-matching` | **Enabled** | **Message body** | `{"type":["trip.requested"]}` |
| `ridenow-prod-payment` | **Enabled** | **Message body** | `{"type":["trip.completed","trip.cancelled"]}` |
| `ridenow-prod-notifications` | **Enabled** | - | none (receives every event) |

Choose the **Message body** scope, not the default **Message attributes**: the `type`
lives in the JSON body, so a filter on attributes would drop every message.

## 5. Let the topic write to each queue

SNS can only deliver if the queue's access policy allows it. For each queue: SQS ->
the queue -> **Access policy** -> **Edit**, and allow `sns.amazonaws.com`
`sqs:SendMessage` on the queue ARN, with an `ArnEquals` condition that sets
`aws:SourceArn` to the **topic ARN**. Then only this topic can write to the queue, not any
topic in the account.

---

## 6. Give the pods permission (IRSA)

Each service gets its own policy, scoped to the exact ARNs it uses, and its own IRSA
role trusting only its own Kubernetes service account
(`system:serviceaccount:ridenow:<service>`):

| Service | Permissions |
|---------|-------------|
| trip-service | `sns:Publish` on the topic |
| payment-service | `sns:Publish` on the topic; `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` on `ridenow-prod-payment` |
| matching-service | `sns:Publish` on the topic; the same three SQS actions on `ridenow-prod-matching` |
| notification-worker | the same three SQS actions on `ridenow-prod-notifications` |

Create each role trusting the cluster OIDC provider (guide 05 Part D), then put its ARN
in the service account annotation in `iac/k8s/22-25`. This is how pods get AWS access without static keys.
realtime-gateway needs no AWS access.

## 7. Set the env and roll out

The manifests in `iac/k8s/` already carry these settings. Fill in the placeholders:

```
# trip-service
SPRING_PROFILES_ACTIVE = sns
RIDENOW_EVENTS_TOPIC_ARN = arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events

# payment-service
SPRING_PROFILES_ACTIVE = sns
RIDENOW_EVENTS_TOPIC_ARN = arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events
RIDENOW_PAYMENT_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-payment

# matching-service
SPRING_PROFILES_ACTIVE = sns
RIDENOW_EVENTS_TOPIC_ARN = arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events
RIDENOW_MATCHING_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-matching

# notification-worker
RIDENOW_NOTIFICATIONS_QUEUE_URL = https://sqs.ap-southeast-1.amazonaws.com/<ACCOUNT_ID>/ridenow-prod-notifications

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
- `ridenow-prod-notifications` receives every event, and
  `GET /api/notifications?userId={passengerId}` lists them in order.
- Force a failure (for example, a malformed message sent to a queue by hand) and watch it land in
  that queue's `-dlq` after 5 receives.
- If a queue stays empty while the topic's **Number of messages published** grows, check
  the subscription: the filter policy scope must be **Message body**, and **Raw message
  delivery** must be on.

## Clean up

SNS and SQS cost little, but to tidy up, delete the three subscriptions, then the topic,
then all six queues. Remove the env vars (or the `sns` profile) and the services
fall back to the logging publisher, while the consumers stay off.
