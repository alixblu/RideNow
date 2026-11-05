# 09 - Later op: SQS + EventBridge (manual console)

Goal (when you want async notifications live): the bus/queue/rule the code
already publishes to and consumes from, created in the console; then
trip/payment events fan out through EventBridge to SQS and notification-worker
processes them with retries + DLQ.

This is **identical** to `../aws/08-later-sqs-eventbridge.md` - follow it
click-by-click (create DLQ, work queue with redrive maxReceiveCount 5, event bus,
rule with pattern `{"source":[{"prefix":"ridenow."}]}` -> SQS target, IRSA roles,
set the env, roll out).

---

## Hybrid notes

- **IRSA trust** references the cluster's **OIDC provider** you enabled in
  `06-eks-cluster.md` (step 4) - the same one, whether the foundation came from
  CloudFormation or console.
- The **notification-worker manifest** (`iac/k8s/25-notification-worker.yaml`)
  already ships a ServiceAccount with an
  `eks.amazonaws.com/role-arn: <NOTIFICATION_WORKER_ROLE_ARN>` annotation. Fill
  that placeholder with the IRSA role ARN you create here (the one granting
  `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` on the queue), then
  re-apply the manifest.
- Set on **trip/payment**: `SPRING_PROFILES_ACTIVE=eventbridge`,
  `RIDENOW_EVENTS_BUS_NAME=<your bus>`, `AWS_REGION`; drop any static AWS keys so
  IRSA is used. Set on **notification-worker**: `RIDENOW_NOTIFICATIONS_QUEUE_URL`,
  `AWS_REGION`. Then `kubectl rollout restart` the three.

> As with Redis, `iac/stacks/05-messaging.yaml` can create the queue/DLQ/bus via
> CloudFormation (gated off; `EnableMessaging=true`). This route does it manually
> on purpose.

## Verify

Per `../aws/08`: drive a trip + charge a payment -> SQS shows messages received,
notification-worker logs one "notification sent" per event, and a poison message
lands in the DLQ after 5 receives.

This completes the hybrid route: CloudFormation foundation (1-4) + manual EKS and
later ops (5-9).
