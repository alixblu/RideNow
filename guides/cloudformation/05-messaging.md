# 05 - Messaging and cache (SNS, SQS, Valkey)

Stack `ridenow-<env>-05-messaging` from `iac/stacks/05-messaging.yaml`.
Depends on: `02-network` (imports `PrivateSubnetIds`, `VpcId`, `NodeSecurityGroupId`).

## What it creates

- One SNS topic, `ridenow-<env>-events`. Every service publishes domain events to it.
- Three SQS work queues, each with its own dead-letter queue (DLQ, 14-day retention) and SQS-managed encryption:
  - `ridenow-<env>-matching` receives only `trip.requested` (consumer: matching-service).
  - `ridenow-<env>-payment` receives only `trip.completed` and `trip.cancelled` (consumer: payment-service).
  - `ridenow-<env>-notifications` receives every event, with no filter (consumer: notification-worker).
- One SNS subscription per queue with raw message delivery, so the SQS body is the event JSON. Filters match the top-level `type` field of the body.
- One queue policy per queue that lets only this topic (matched by `aws:SourceArn`) send messages.
- An ElastiCache for Valkey replication group `ridenow-<env>-redis` (Redis protocol, 2 nodes, Multi-AZ with automatic failover, encryption at rest and TLS in transit). It holds driver GEO and live state, the location Pub/Sub channel, and the driver-locations stream.
- A Redis security group that allows port 6379 only from the cluster security group (`NodeSecurityGroupId`), plus a subnet group on the private subnets.

The topic and queues are created only when `EnableMessaging=true`. The cache is created only when `EnableRedis=true`.

## Deploy

### Configure

Show the parameters this stack will receive from `iac/params/$ENV.json`:

```bash
params 05-messaging
```

Expected for `prod`: `Environment=prod`, `EnableMessaging=true`, `EnableRedis=true`, `RedisNodeType=cache.t4g.small`.

`MaxReceiveCount` (deliveries before a message moves to its DLQ, default `5`) is not set in the params file. To override it for one run, pass it to `cfn_deploy` (see Run below).

### Run

Deploy the stack with the shared helper. The Valkey replication group usually takes 10 to 15 minutes; the rest is fast.

```bash
cfn_deploy 05-messaging
```

Expected last line: `Successfully created/updated stack - ridenow-prod-05-messaging`.

To change `MaxReceiveCount` once instead:

```bash
cfn_deploy 05-messaging MaxReceiveCount=3
```

Check the stack status:

```bash
stack_status 05-messaging
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

### If it fails

Show the newest failed events and their reasons:

```bash
stack_failures 05-messaging
```

`Export ... cannot be imported` or `No export named ...network-...`: deploy `02-network.md` first. A stack in `ROLLBACK_COMPLETE` must be deleted before it can be deployed again (see `README.md`).

## Post-Deploy

No post-deploy configuration is needed for this stack.

## Verify

Load the exports used below:

```bash
TOPIC_ARN=$(exp messaging-TripEventTopicArn); echo $TOPIC_ARN
```

Expected: `arn:aws:sns:ap-southeast-1:<account>:ridenow-prod-events`.

List the stack outputs (topic, three queue URLs and ARNs, Redis endpoint, Redis security group):

```bash
stack_outputs 05-messaging
```

Expected: nine rows: `TripEventTopicArn`, `NotificationQueueUrl`, `NotificationQueueArn`, `MatchingQueueUrl`, `MatchingQueueArn`, `PaymentQueueUrl`, `PaymentQueueArn`, `RedisPrimaryEndpoint`, `RedisSecurityGroupId`.

Check that three work queues and three DLQs exist:

```bash
aws sqs list-queues --queue-name-prefix ridenow-$ENV- \
  --query 'QueueUrls' --output text | tr '\t' '\n' | sort
```

Expected: six URLs ending in `-matching`, `-matching-dlq`, `-notifications`, `-notifications-dlq`, `-payment`, `-payment-dlq`.

Check each work queue's redrive policy points at its DLQ with the configured `maxReceiveCount`:

```bash
for Q in Matching Payment Notification; do
  aws sqs get-queue-attributes --queue-url "$(exp messaging-${Q}QueueUrl)" \
    --attribute-names RedrivePolicy --query 'Attributes.RedrivePolicy' --output text | jq -c .
done
```

Expected: three lines, each with a `deadLetterTargetArn` ending in `-dlq` and `"maxReceiveCount":5` (or the value you set).

Check the subscriptions and their filter policies:

```bash
for SUB in $(aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN \
    --query 'Subscriptions[].SubscriptionArn' --output text); do
  aws sns get-subscription-attributes --subscription-arn $SUB \
    --query 'Attributes.[Endpoint,RawMessageDelivery,FilterPolicy]' --output text
done
```

Expected: three lines, all with `true` for raw delivery. The matching queue shows `{"type":["trip.requested"]}`, the payment queue shows `{"type":["trip.completed","trip.cancelled"]}`, and the notifications queue shows `None` (no filter).

Check that the queue policy on one queue allows only this topic:

```bash
aws sqs get-queue-attributes --queue-url "$(exp messaging-MatchingQueueUrl)" \
  --attribute-names Policy --query 'Attributes.Policy' --output text \
  | jq '.Statement[0] | {Principal, Action, Condition}'
```

Expected: principal `sns.amazonaws.com`, action `sqs:SendMessage`, and `aws:SourceArn` equal to `$TOPIC_ARN`.

Check the Valkey replication group:

```bash
aws elasticache describe-replication-groups --replication-group-id ridenow-$ENV-redis \
  --query 'ReplicationGroups[0].[Status,Engine,TransitEncryptionEnabled,AtRestEncryptionEnabled,AutomaticFailover,MultiAZ]' \
  --output text
```

Expected: `available  valkey  True  True  enabled  enabled`.

Check the endpoint export and the port 6379 rule:

```bash
exp messaging-RedisPrimaryEndpoint
aws ec2 describe-security-groups --group-ids "$(exp messaging-RedisSecurityGroupId)" \
  --query 'SecurityGroups[0].IpPermissions[].[FromPort,ToPort,UserIdGroupPairs[0].GroupId]' --output text
exp network-NodeSecurityGroupId
```

Expected: a host name like `master.ridenow-prod-redis.<id>.apse1.cache.amazonaws.com`, then `6379  6379  <sg-id>`, where that `<sg-id>` equals the last line (the cluster security group).

## Final check

Run this once the whole deployment is finished. It only reads.

```bash
stack_status 05-messaging
```

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

Next: `06-eks-cluster.md`.
