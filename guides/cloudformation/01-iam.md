# 01 - IAM

Creates the two EKS roles and six customer managed policies of `iac/stacks/01-iam.yaml` in the IAM console. Region does not matter for IAM.

## What it creates

| Template logical ID | AWS resource type | Name |
|---------------------|-------------------|------|
| `ClusterRole` | IAM role | `ridenow-prod-eks-cluster-role` |
| `FargatePodExecutionRole` | IAM role (with inline policy `fargate-log-router-logs`) | `ridenow-prod-eks-fargate-pod-execution-role` |
| `AppAccessPolicy` | IAM customer managed policy | `ridenow-prod-app-access` |
| `TripServiceMessagingPolicy` | IAM customer managed policy | `ridenow-prod-trip-service-messaging` |
| `PaymentServiceMessagingPolicy` | IAM customer managed policy | `ridenow-prod-payment-service-messaging` |
| `MatchingServiceMessagingPolicy` | IAM customer managed policy | `ridenow-prod-matching-service-messaging` |
| `NotificationWorkerMessagingPolicy` | IAM customer managed policy | `ridenow-prod-notification-worker-messaging` |
| `AdotCollectorXRayPolicy` | IAM customer managed policy | `ridenow-prod-adot-collector-xray` |

## Depends on

Nothing. Start with the tools and identity listed in [README.md](README.md). The eight resources can be created in any order.

Look up this value yourself before you start:

| Value | Where to find it in the console |
|-------|---------------------------------|
| Account ID (12 digits), used wherever a policy shows `<ACCOUNT_ID>` | Top-right account menu in the console, copy **Account ID** |

## Create the resources

### 1. Role `ridenow-prod-eks-cluster-role` (`ClusterRole`)

**Start and trust policy**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Custom trust policy`.
3. Delete the default JSON in **Custom trust policy**.
4. Paste the JSON below.
5. Choose **Next**.

**Permissions**

6. Search for `AmazonEKSClusterPolicy` and tick it.
7. Search for `AmazonEKSComputePolicy` and tick it.
8. Search for `AmazonEKSBlockStoragePolicyV2` and tick it.
9. Search for `AmazonEKSLoadBalancingPolicy` and tick it.
10. Search for `AmazonEKSNetworkingPolicy` and tick it.
11. Choose **Next**.

**Name and create**

12. Set **Role name** to `ridenow-prod-eks-cluster-role`.
13. Leave **Description** at the default.
14. Choose **Create role**.
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "eks.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession"]
    }
  ]
}
```

### 2. Role `ridenow-prod-eks-fargate-pod-execution-role` (`FargatePodExecutionRole`)

**Start and trust policy**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Custom trust policy`.
3. Delete the default JSON in **Custom trust policy**.
4. Paste the JSON below.
5. Choose **Next**.

**Permissions**

6. Search for `AmazonEKSFargatePodExecutionRolePolicy` and tick it.
7. Choose **Next**.

**Name and create**

8. Set **Role name** to `ridenow-prod-eks-fargate-pod-execution-role`.
9. Leave **Description** at the default.
10. Choose **Create role**.
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "eks-fargate-pods.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Add the inline policy `fargate-log-router-logs`**

The managed policy has no `logs:*` actions, so the Fargate log router cannot write pod logs without this inline policy. It does not grant `logs:CreateLogGroup`: the log group `/aws/eks/ridenow-prod/fargate` is created in `10-cloudwatch.md` and the router runs with `auto_create_group false`.

11. Go to **IAM -> Roles** and open `ridenow-prod-eks-fargate-pod-execution-role`.
12. On the **Permissions** tab, choose **Add permissions -> Create inline policy**.
13. Set **Policy editor** to `JSON`.
14. Delete the default JSON.
15. Paste the JSON below.
16. Replace each `<ACCOUNT_ID>` with your account id.
17. Choose **Next**.
18. Set **Policy name** to `fargate-log-router-logs`.
19. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WritePodLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/aws/eks/ridenow-prod/fargate",
        "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/aws/eks/ridenow-prod/fargate:log-stream:*"
      ]
    }
  ]
}
```

Expected: the role's **Permissions** tab lists `AmazonEKSFargatePodExecutionRolePolicy` (AWS managed) and `fargate-log-router-logs` (inline).

### 3. Policy `ridenow-prod-app-access` (`AppAccessPolicy`)

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Replace each `<ACCOUNT_ID>` with your account id.
6. Leave the `*` region parts unchanged.
7. Choose **Next**.
8. Set **Policy name** to `ridenow-prod-app-access`.
9. Set **Description** to `Scoped runtime access for RideNow pods via IRSA: pull images, read DB secrets, and (where present) use the environment's queues and event bus.`
10. Choose **Create policy**.

The description cannot be edited later, so type it exactly.
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPullRideNow",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "arn:aws:ecr:*:<ACCOUNT_ID>:repository/ridenow/*"
    },
    {
      "Sid": "ReadRideNowSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:*:<ACCOUNT_ID>:secret:ridenow-prod-*"
    }
  ]
}
```

### 4. Policy `ridenow-prod-trip-service-messaging` (`TripServiceMessagingPolicy`)

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Replace each `<ACCOUNT_ID>` with your account id.
6. Choose **Next**.
7. Set **Policy name** to `ridenow-prod-trip-service-messaging`.
8. Set **Description** to `trip-service publishes trip events to the RideNow topic.`
9. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishToRideNowTopic",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events"
    }
  ]
}
```

### 5. Policy `ridenow-prod-payment-service-messaging` (`PaymentServiceMessagingPolicy`)

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Replace each `<ACCOUNT_ID>` with your account id.
6. Choose **Next**.
7. Set **Policy name** to `ridenow-prod-payment-service-messaging`.
8. Set **Description** to `payment-service publishes payment events and consumes the payment queue.`
9. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishToRideNowTopic",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events"
    },
    {
      "Sid": "ConsumePaymentQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-payment"
    }
  ]
}
```

### 6. Policy `ridenow-prod-matching-service-messaging` (`MatchingServiceMessagingPolicy`)

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Replace each `<ACCOUNT_ID>` with your account id.
6. Choose **Next**.
7. Set **Policy name** to `ridenow-prod-matching-service-messaging`.
8. Set **Description** to `matching-service publishes match events and consumes the matching queue.`
9. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishToRideNowTopic",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-events"
    },
    {
      "Sid": "ConsumeMatchingQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-matching"
    }
  ]
}
```

### 7. Policy `ridenow-prod-notification-worker-messaging` (`NotificationWorkerMessagingPolicy`)

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Replace each `<ACCOUNT_ID>` with your account id.
6. Choose **Next**.
7. Set **Policy name** to `ridenow-prod-notification-worker-messaging`.
8. Set **Description** to `notification-worker consumes the notifications queue.`
9. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeNotificationsQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:<ACCOUNT_ID>:ridenow-prod-notifications"
    }
  ]
}
```

### 8. Policy `ridenow-prod-adot-collector-xray` (`AdotCollectorXRayPolicy`)

Only the ADOT Collector sends traces to X-Ray, so only its role (`07-eks-addons.md`, step 5) gets this policy. Do not attach it to a service role. X-Ray write and sampling actions do not support resource-level permissions, so `Resource` must be `*`.

1. Go to **IAM -> Policies -> Create policy**.
2. Set **Policy editor** to `JSON`.
3. Delete the default JSON.
4. Paste the JSON below.
5. Choose **Next**.
6. Set **Policy name** to `ridenow-prod-adot-collector-xray`.
7. Set **Description** to `ADOT Collector writes traces to X-Ray and reads sampling rules.`
8. Choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "XRayWriteAndSampling",
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries"
      ],
      "Resource": "*"
    }
  ]
}
```

Expected: the policy `ridenow-prod-adot-collector-xray` is listed under **IAM -> Policies** as `Customer managed`, and its **Permissions** tab shows five X-Ray actions on `All resources`. The template exports its ARN as `iam-AdotCollectorXRayPolicyArn` (full export name `ridenow-prod-iam-AdotCollectorXRayPolicyArn`); in the console you pick the policy by name.

## Values to record

Nothing to copy now: later guides pick these by name in the console. To read an ARN, open the role or policy in IAM and copy **ARN** at the top.

| Output_Equivalent (Template output) | Resource it comes from | ARN form | Consumed by |
|-------|------------------------|----------|-------------|
| `ClusterRoleArn` | role `ridenow-prod-eks-cluster-role` | `arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-eks-cluster-role` | `06-eks-cluster.md`: **Cluster service role** |
| `FargatePodExecutionRoleArn` | role `ridenow-prod-eks-fargate-pod-execution-role` | `arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-eks-fargate-pod-execution-role` | `06-eks-cluster.md`: **Pod execution role** |
| `AppAccessPolicyArn` | policy `ridenow-prod-app-access` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-app-access` | No guide attaches it |
| `TripServiceMessagingPolicyArn` | policy `ridenow-prod-trip-service-messaging` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-trip-service-messaging` | `07-eks-addons.md`: role `ridenow-prod-trip-service` |
| `PaymentServiceMessagingPolicyArn` | policy `ridenow-prod-payment-service-messaging` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-payment-service-messaging` | `07-eks-addons.md`: role `ridenow-prod-payment-service` |
| `MatchingServiceMessagingPolicyArn` | policy `ridenow-prod-matching-service-messaging` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-matching-service-messaging` | `07-eks-addons.md`: role `ridenow-prod-matching-service` |
| `NotificationWorkerMessagingPolicyArn` | policy `ridenow-prod-notification-worker-messaging` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-notification-worker-messaging` | `07-eks-addons.md`: role `ridenow-prod-notification-worker` |
| `AdotCollectorXRayPolicyArn` (export `iam-AdotCollectorXRayPolicyArn`) | policy `ridenow-prod-adot-collector-xray` | `arn:aws:iam::<ACCOUNT_ID>:policy/ridenow-prod-adot-collector-xray` | `07-eks-addons.md`: role `ridenow-prod-adot-collector` |

## Post-Deploy

No Post-Deploy step is needed for this guide.

## Verify

Replace `<ACCOUNT_ID>` with the Account ID from the table in **Depends on**, then run:

```bash
ACCOUNT_ID=<from table>
aws iam list-policies --scope Local \
  --query "Policies[?starts_with(PolicyName,'ridenow-prod-')].PolicyName" --output text | tr '\t' '\n'
aws iam get-role --role-name ridenow-prod-eks-cluster-role --query Role.Arn --output text
aws iam get-role --role-name ridenow-prod-eks-fargate-pod-execution-role --query Role.Arn --output text
aws iam get-role-policy --role-name ridenow-prod-eks-fargate-pod-execution-role \
  --policy-name fargate-log-router-logs --query PolicyDocument.Statement[0].Action --output text
aws iam get-policy-version --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/ridenow-prod-adot-collector-xray \
  --version-id v1 --query PolicyVersion.Document.Statement[0].Action --output text
```

Expected: six policy names (`ridenow-prod-app-access`, the four `-messaging` policies and `ridenow-prod-adot-collector-xray`), then `arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-eks-cluster-role` and `arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-eks-fargate-pod-execution-role`, then the three log actions (`logs:CreateLogStream`, `logs:DescribeLogStreams`, `logs:PutLogEvents`), then the five X-Ray actions. A missing line means that resource was not created or is misspelled.

Next: [02-network.md](02-network.md).
