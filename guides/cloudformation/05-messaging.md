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

This guide needs five values. Look each one up once, before you start, using the console path in the last column.

| Value | Template import | Created in | Where to find it in the console |
|---|---|---|---|
| `ACCOUNT_ID` (12-digit account ID) | none | your AWS account | Click your account name in the top-right corner of the console. The 12-digit **Account ID** is in the menu. |
| `REGION` (`ap-southeast-1`) | none | fixed by this workshop | The region selector in the top-right corner must read **Asia Pacific (Singapore) ap-southeast-1**. |
| VPC id (`vpc-...`) | `network-VpcId` | `02-network.md`, step 1 | **VPC -> Your VPCs** -> row `ridenow-prod-vpc` -> **VPC ID**. |
| Private subnets `ridenow-prod-private-1` and `ridenow-prod-private-2` | `network-PrivateSubnetIds` | `02-network.md`, step 3 | **VPC -> Subnets** -> rows `ridenow-prod-private-1` and `ridenow-prod-private-2` -> **Subnet ID** (`subnet-...`) and **Availability Zone**. |
| Cluster security group id (`sg-...`) | `network-NodeSecurityGroupId` | `02-network.md`, step 7 | **VPC -> Security groups** -> row `ridenow-prod-cluster-sg` -> **Security group ID**. |

How the values are used:

- Wherever a step or a JSON policy shows `ACCOUNT_ID`, type your 12-digit account ID in its place. The region is already written as `ap-southeast-1`.
- Step 5 uses the VPC and the two private subnets.
- Step 6 uses the VPC and the cluster security group.
## Create the resources

Follow the steps in order.

### 1. SNS topic (`TripEventTopic`)

1. Go to **Amazon SNS -> Topics -> Create topic**.
2. Set **Type** to `Standard`.
3. Set **Name** to `ridenow-prod-events`.
4. Leave **Encryption** disabled (the `aws/sns` key blocks delivery to SQS).
5. Leave **Access policy** at the default.
6. Choose **Create topic**.
7. Copy the topic ARN. It has the form `arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-events`.

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
9. Replace the JSON with the policy below for this queue, and replace `ACCOUNT_ID` with your account ID (see **Depends on**).

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
      "Resource": "arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-matching",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-events" } }
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
      "Resource": "arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-payment",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-events" } }
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
      "Resource": "arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-notifications",
      "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-events" } }
    }
  ]
}
```

### 4. Subscriptions (`MatchingSubscription`, `PaymentSubscription`, `NotificationSubscription`)

**Matching subscription**

1. Go to **Amazon SNS -> Topics -> `ridenow-prod-events` -> Subscriptions** tab -> **Create subscription**.
2. Set **Protocol** to `Amazon SQS`.
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-matching`.
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
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-payment`.
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
3. Set **Endpoint** to `arn:aws:sqs:ap-southeast-1:ACCOUNT_ID:ridenow-prod-notifications`.
4. Check **Enable raw message delivery**.
5. Leave **Subscription filter policy** off (it receives every event).
6. Leave **Redrive policy (dead-letter queue)** off.
7. Choose **Create subscription**.

Note: each subscription shows Status `Confirmed`. If it shows `Pending confirmation`, recheck the queue access policy from step 3.

### 5. Redis subnet group (`RedisSubnetGroup`)

1. Go to **Amazon ElastiCache -> Subnet groups -> Create subnet group**.
2. Set **Name** to `ridenow-prod-redis-subnets`.
3. Set **Description** to `ridenow-prod Redis private subnets`.
4. Set **VPC ID** to `ridenow-prod-vpc` (the VPC id from **Depends on**).
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

11. Choose **Add new tag**, set **Key** to `Name` and **Value** to `ridenow-prod-redis-sg`.
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

Note these values in a text file. Later guides ask for them.

| Output (Template) | Value | Where to see it in the console | Used by |
|---|---|---|---|
| `TripEventTopicArn` | topic ARN | **Amazon SNS -> Topics** -> `ridenow-prod-events` -> **ARN** | Service manifests (service manifests set `RIDENOW_EVENTS_TOPIC_ARN` from it) |
| `MatchingQueueUrl` | queue URL | **Amazon SQS -> Queues** -> `ridenow-prod-matching` -> **URL** | Service manifests (`<MATCHING_QUEUE_URL>` in `iac/k8s/24-matching-service.yaml`) |
| `MatchingQueueArn` | queue ARN | **Amazon SQS -> Queues** -> `ridenow-prod-matching` -> **ARN** | Connection checks |
| `PaymentQueueUrl` | queue URL | **Amazon SQS -> Queues** -> `ridenow-prod-payment` -> **URL** | Service manifests (`<PAYMENT_QUEUE_URL>` in `iac/k8s/23-payment-service.yaml`) |
| `PaymentQueueArn` | queue ARN | **Amazon SQS -> Queues** -> `ridenow-prod-payment` -> **ARN** | Connection checks |
| `NotificationQueueUrl` | queue URL | **Amazon SQS -> Queues** -> `ridenow-prod-notifications` -> **URL** | Service manifests (`<NOTIFICATIONS_QUEUE_URL>` in `iac/k8s/25-notification-worker.yaml`) |
| `NotificationQueueArn` | queue ARN | **Amazon SQS -> Queues** -> `ridenow-prod-notifications` -> **ARN** | Connection checks |
| `RedisPrimaryEndpoint` | host name (no `:6379`) | **Amazon ElastiCache -> Valkey caches** -> `ridenow-prod-redis` -> **Primary endpoint** | Service manifests (`<REDIS_ENDPOINT>` in the driver, matching, notification and realtime manifests) |
| `RedisSecurityGroupId` | security group id (`sg-...`) | **VPC -> Security groups** -> `ridenow-prod-redis-sg` -> **Security group ID** | `07-eks-addons.md` (ingress rule from the EKS cluster security group) |
## Post-Deploy

No post-deploy configuration is needed. `07-eks-addons.md` opens `ridenow-prod-redis-sg` to the Fargate pods.

## Verify

Set your account ID from the **Depends on** table, then run the commands. Every other name is written out in full.

```bash
ACCOUNT_ID=123456789012   # replace with your 12-digit account ID
aws sns list-subscriptions-by-topic --region ap-southeast-1 \
  --topic-arn "arn:aws:sns:ap-southeast-1:${ACCOUNT_ID}:ridenow-prod-events" \
  --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text
for Q in ridenow-prod-matching ridenow-prod-payment ridenow-prod-notifications; do
  aws sqs get-queue-url --region ap-southeast-1 --queue-name "$Q" --query QueueUrl --output text
done
aws elasticache describe-replication-groups --region ap-southeast-1 \
  --replication-group-id ridenow-prod-redis \
  --query 'ReplicationGroups[0].[Status,NodeGroups[0].PrimaryEndpoint.Address]' --output text
aws ec2 describe-security-groups --region ap-southeast-1 \
  --filters "Name=group-name,Values=ridenow-prod-redis-sg" \
  --query 'SecurityGroups[0].GroupId' --output text
```

Expected: three subscriptions with full ARNs (not `PendingConfirmation`), three queue URLs, `available` with a host name, and one `sg-...` id. If one is missing or `None`, open the console page for that resource and check the name.
Next: `06-eks-cluster.md`.
