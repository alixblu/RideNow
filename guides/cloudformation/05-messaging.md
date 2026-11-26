# 05 - Messaging and cache (SNS, SQS, Valkey)

You create one SNS topic, three SQS queues with their dead-letter queues, three subscriptions and a Valkey replication group by hand in the AWS Console, following `iac/stacks/05-messaging.yaml`. Region `ap-southeast-1`, parameters from `iac/params/prod.json` layer `05-messaging` (`EnableMessaging=true`, `EnableRedis=true`, `RedisNodeType=cache.t4g.small`; `MaxReceiveCount` is not in the file, so the Template default `5` applies).

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `TripEventTopic` | SNS topic | `ridenow-prod-events` |
| `NotificationDlq` | SQS queue | `ridenow-prod-notifications-dlq` |
| `NotificationQueue` | SQS queue | `ridenow-prod-notifications` |
| `MatchingDlq` | SQS queue | `ridenow-prod-matching-dlq` |
| `MatchingQueue` | SQS queue | `ridenow-prod-matching` |
| `PaymentDlq` | SQS queue | `ridenow-prod-payment-dlq` |
| `PaymentQueue` | SQS queue | `ridenow-prod-payment` |
| `MatchingSubscription` | SNS subscription | topic `ridenow-prod-events` to `ridenow-prod-matching` |
| `PaymentSubscription` | SNS subscription | topic `ridenow-prod-events` to `ridenow-prod-payment` |
| `NotificationSubscription` | SNS subscription | topic `ridenow-prod-events` to `ridenow-prod-notifications` |
| `MatchingQueuePolicy` | SQS queue policy | on `ridenow-prod-matching` |
| `PaymentQueuePolicy` | SQS queue policy | on `ridenow-prod-payment` |
| `NotificationQueuePolicy` | SQS queue policy | on `ridenow-prod-notifications` |
| `RedisSubnetGroup` | ElastiCache subnet group | `ridenow-prod-redis-subnets` |
| `RedisSecurityGroup` | EC2 security group | `ridenow-prod-redis-sg` |
| `RedisReplicationGroup` | ElastiCache replication group | `ridenow-prod-redis` |

## Depends on

From `02-network.md`. Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws) first and check these values are not `MISSING`:

| Value | Template import | Resource it comes from | Used for |
|---|---|---|---|
| `PRIVATE_SUBNET_IDS` | `network-PrivateSubnetIds` | subnets `ridenow-prod-private-1`, `ridenow-prod-private-2` | Redis subnet group |
| `VPC_ID` | `network-VpcId` | VPC `ridenow-prod-vpc` | Redis security group |
| `NODE_SG_ID` | `network-NodeSecurityGroupId` | security group `ridenow-prod-cluster-sg` | source of the port 6379 rule |

## Create the resources

Follow the steps in order. `<ACCOUNT_ID>` is your 12-digit account ID (top-right menu in the console).

### 1. SNS topic (`TripEventTopic`)

1. Go to **Amazon SNS -> Topics -> Create topic**.
2. Set **Type** to `Standard`.
3. Set **Name** to `ridenow-prod-events`.
4. Leave **Encryption** disabled (the `aws/sns` key blocks delivery to SQS).
5. Leave **Access policy** at the default.
6. Choose **Create topic**.
7. Copy the topic ARN: `arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events`.

### 2. Dead-letter queues (`NotificationDlq`, `MatchingDlq`, `PaymentDlq`)

Repeat this list three times, with the names `ridenow-prod-notifications-dlq`, `ridenow-prod-matching-dlq` and `ridenow-prod-payment-dlq`.

1. Go to **Amazon SQS -> Queues -> Create queue**.
2. Set **Type** to `Standard`.
3. Set **Name** to one of the three DLQ names.

   **Configuration**

4. Set **Visibility timeout** to `30` **Seconds** (the default).
5. Set **Message retention period** to `14` **Days**.

   **Encryption**

6. Set **Server-side encryption** to `Enabled`.
7. Set **Encryption key type** to `Amazon SQS key (SSE-SQS)`.

   **Policies**

8. Leave **Access policy** at `Basic` (the default).
9. Set **Dead-letter queue** to `Disabled`.
10. Choose **Create queue**.

### 3. Work queues and access policies (`NotificationQueue`, `MatchingQueue`, `PaymentQueue`, and their queue policies)

Repeat this list three times, with these queue and DLQ pairs:

| Queue name | Dead-letter queue |
|---|---|
| `ridenow-prod-matching` | `ridenow-prod-matching-dlq` |
| `ridenow-prod-payment` | `ridenow-prod-payment-dlq` |
| `ridenow-prod-notifications` | `ridenow-prod-notifications-dlq` |

1. Go to **Amazon SQS -> Queues -> Create queue**.
2. Set **Type** to `Standard`.
3. Set **Name** to the queue name from the table.

   **Configuration**

4. Set **Visibility timeout** to `1` **Minutes** (60 seconds).
5. Set **Message retention period** to `4` **Days** (the default).

   **Encryption**

6. Set **Server-side encryption** to `Enabled`.
7. Set **Encryption key type** to `Amazon SQS key (SSE-SQS)`.

   **Access policy**

8. Select **Advanced**.
9. Replace the JSON with the policy below for this queue, and replace `<ACCOUNT_ID>`.

   **Dead-letter queue**

10. Set **Dead-letter queue** to `Enabled`.
11. In **Choose queue**, pick the DLQ from the table.
12. Set **Maximum receives** to `5`.
13. Choose **Create queue**.

Access policy for `ridenow-prod-matching`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRideNowTopic",
      "Effect": "Allow",
      "Principal": { "Service": "sns.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-matching",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events" } }
    }
  ]
}
```

Access policy for `ridenow-prod-payment`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRideNowTopic",
      "Effect": "Allow",
      "Principal": { "Service": "sns.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-payment",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events" } }
    }
  ]
}
```

Access policy for `ridenow-prod-notifications`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRideNowTopic",
      "Effect": "Allow",
      "Principal": { "Service": "sns.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-notifications",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events" } }
    }
  ]
}
```

### 4. Subscriptions (`MatchingSubscription`, `PaymentSubscription`, `NotificationSubscription`)

**Matching subscription**

1. Go to **Amazon SNS -> Topics -> `ridenow-prod-events` -> Subscriptions** tab -> **Create subscription**.
2. Set **Protocol** to `Amazon SQS`.
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-matching`.
4. Check **Enable raw message delivery**.
5. Expand **Subscription filter policy** and turn it on.
6. Set **Filter policy scope** to `Message body`.
7. Paste the matching filter below into the JSON editor.
8. Leave **Redrive policy (dead-letter queue)** off.
9. Choose **Create subscription**.

```json
{
  "type": ["trip.requested"]
}
```

**Payment subscription**

1. Go to **Amazon SNS -> Topics -> `ridenow-prod-events` -> Subscriptions** tab -> **Create subscription**.
2. Set **Protocol** to `Amazon SQS`.
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-payment`.
4. Check **Enable raw message delivery**.
5. Expand **Subscription filter policy** and turn it on.
6. Set **Filter policy scope** to `Message body`.
7. Paste the payment filter below into the JSON editor.
8. Leave **Redrive policy (dead-letter queue)** off.
9. Choose **Create subscription**.

```json
{
  "type": ["trip.completed", "trip.cancelled"]
}
```

**Notification subscription**

1. Go to **Amazon SNS -> Topics -> `ridenow-prod-events` -> Subscriptions** tab -> **Create subscription**.
2. Set **Protocol** to `Amazon SQS`.
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-notifications`.
4. Check **Enable raw message delivery**.
5. Leave **Subscription filter policy** off (it receives every event).
6. Leave **Redrive policy (dead-letter queue)** off.
7. Choose **Create subscription**.

Note: each subscription shows Status `Confirmed`. If it shows `Pending confirmation`, recheck the queue access policy from step 3.

### 5. Redis subnet group (`RedisSubnetGroup`)

1. Go to **Amazon ElastiCache -> Subnet groups -> Create subnet group**.
2. Set **Name** to `ridenow-prod-redis-subnets`.
3. Set **Description** to `ridenow-prod Redis private subnets`.
4. Set **VPC ID** to `ridenow-prod-vpc`.
5. Under **Selected subnets**, pick the Availability Zones first, then tick `ridenow-prod-private-1` and `ridenow-prod-private-2`.
6. Choose **Create**.

### 6. Redis security group (`RedisSecurityGroup`)

1. Go to **EC2 -> Security Groups -> Create security group**.
2. Set **Security group name** to `ridenow-prod-redis-sg`.
3. Set **Description** to `ridenow-prod Redis (private)`.
4. Set **VPC** to `ridenow-prod-vpc`.

   **Inbound rules**

5. Choose **Add rule**.
6. Set **Type** to `Custom TCP`.
7. Set **Port range** to `6379`.
8. Set **Source** to `Custom`, then pick the security group `ridenow-prod-cluster-sg`.
9. Set **Description** to `Redis 6379 from EKS nodes only`.

   **Outbound rules**

10. Leave the default (`All traffic`, `0.0.0.0/0`).

    **Tags**

11. Choose **Add new tag**, set **Key** to `Name` and **Value** to `ridenow-prod-redis-sg`. The Discovery_Block finds the group by this tag.
12. Choose **Create security group**.

### 7. Valkey replication group (`RedisReplicationGroup`)

**Create**

1. Go to **Amazon ElastiCache -> Valkey caches -> Create Valkey cache**.
2. Set **Deployment option** to `Design your own cache`.
3. Set **Creation method** to `Cluster cache`.
4. Set **Cluster mode** to `Disabled`.

   **Cluster settings**

5. Set **Name** to `ridenow-prod-redis`.
6. Set **Description** to `ridenow-prod driver GEO / live state`.
7. Set **Engine version** to `8.0`.
8. Set **Port** to `6379`.
9. Set **Parameter group** to `default.valkey8`.
10. Set **Node type** to `cache.t4g.small`.
11. Set **Number of replicas** to `1`.
12. Set **Multi-AZ** to `Enable`.
13. Set **Auto-failover** to `Enable`.

    **Connectivity**

14. Set **Subnet group** to **Choose existing subnet group**, then pick `ridenow-prod-redis-subnets`.
15. Set **Availability Zone placements** to `No preference`.

    **Security**

16. Set **Encryption at rest** to `Enable` (default key).
17. Set **Encryption in transit** to `Enable`.
18. Set **Access control** to `No access control`.
19. Under **Selected security groups**, choose **Manage**.
20. Tick `ridenow-prod-redis-sg` and remove `default`.

    **Backup**

21. Clear **Enable automatic backups**.
22. Choose **Create**.
23. Wait 10 to 15 minutes until **Status** is `Available`.
## Values to record

Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws) again so these variables are set.

| Output (Template) | Discovery_Block variable | How to see it in the console | Used by |
|---|---|---|---|
| `TripEventTopicArn` | `TRIP_EVENTS_TOPIC_ARN` | SNS > Topics > `ridenow-prod-events` > ARN | Runbook (service manifests set `RIDENOW_EVENTS_TOPIC_ARN` from it) |
| `MatchingQueueUrl` | `MATCHING_QUEUE_URL` | SQS > `ridenow-prod-matching` > URL | Runbook (`<MATCHING_QUEUE_URL>` in `iac/k8s/24-matching-service.yaml`) |
| `MatchingQueueArn` | `MATCHING_QUEUE_ARN` | SQS > `ridenow-prod-matching` > ARN | Runbook checks |
| `PaymentQueueUrl` | `PAYMENT_QUEUE_URL` | SQS > `ridenow-prod-payment` > URL | Runbook (`<PAYMENT_QUEUE_URL>` in `iac/k8s/23-payment-service.yaml`) |
| `PaymentQueueArn` | `PAYMENT_QUEUE_ARN` | SQS > `ridenow-prod-payment` > ARN | Runbook checks |
| `NotificationQueueUrl` | `NOTIFICATIONS_QUEUE_URL` | SQS > `ridenow-prod-notifications` > URL | Runbook (`<NOTIFICATIONS_QUEUE_URL>` in `iac/k8s/25-notification-worker.yaml`) |
| `NotificationQueueArn` | `NOTIFICATIONS_QUEUE_ARN` | SQS > `ridenow-prod-notifications` > ARN | Runbook checks |
| `RedisPrimaryEndpoint` | `REDIS_ENDPOINT` | ElastiCache > `ridenow-prod-redis` > Primary endpoint (host only, no `:6379`) | Runbook (`<REDIS_ENDPOINT>` in the driver, matching, notification and realtime manifests) |
| `RedisSecurityGroupId` | `REDIS_SG_ID` | EC2 > Security Groups > `ridenow-prod-redis-sg` | `07-eks-addons.md` (ingress rule from the EKS cluster security group) |

## Post-Deploy

No post-deploy configuration is needed. `07-eks-addons.md` opens `ridenow-prod-redis-sg` to the Fargate pods.

## Verify

Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws), then:

```bash
for V in TRIP_EVENTS_TOPIC_ARN MATCHING_QUEUE_URL PAYMENT_QUEUE_URL NOTIFICATIONS_QUEUE_URL REDIS_ENDPOINT REDIS_SG_ID; do
  echo "$V=${!V:-MISSING}"
done
aws sns list-subscriptions-by-topic --topic-arn "$TRIP_EVENTS_TOPIC_ARN" \
  --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text
```

Expected: six variables with a value (none `MISSING`) and three subscriptions with full ARNs (not `PendingConfirmation`). If one is missing, open the console page for that resource and check the name.

Next: `06-eks-cluster.md`.
