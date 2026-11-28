# 07 - EKS add-ons (pod network access, OIDC provider, IRSA roles, application services)

You create two security group inbound rules, the cluster OIDC provider and seven IRSA roles in the AWS Console, then deploy the ADOT Collector and the seven services with `kubectl`. Reference: `iac/stacks/07-eks-addons.yaml` (read only). Region `ap-southeast-1`, environment `prod`.

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `DbIngressFromFargatePods` | EC2 security group inbound rule | on `ridenow-prod-db-sg`, TCP 5432 |
| `RedisIngressFromFargatePods` | EC2 security group inbound rule | on `ridenow-prod-redis-sg`, TCP 6379 |
| `OidcProvider` | IAM OIDC identity provider | `https://oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>` |
| `AlbControllerRole` | IAM role | `ridenow-prod-alb-controller` |
| `ExternalSecretsRole` | IAM role | `ridenow-prod-external-secrets` |
| `TripServiceRole` | IAM role | `ridenow-prod-trip-service` |
| `PaymentServiceRole` | IAM role | `ridenow-prod-payment-service` |
| `MatchingServiceRole` | IAM role | `ridenow-prod-matching-service` |
| `NotificationWorkerRole` | IAM role | `ridenow-prod-notification-worker` |
| `AdotCollectorRole` | IAM role | `ridenow-prod-adot-collector` |

`OidcProviderId` is empty in `iac/params/prod.json` because the cluster does not exist when the file is written. `OIDC_ID` is the last path segment of the cluster OIDC issuer URL (see the `OIDC_ID` row under Depends on).

## Depends on

Look up each value below in the console and keep it at hand. Use the value names in the first column in the steps and commands of this guide. Region is `ap-southeast-1`, so check the region selector at the top right first.

| Value | Created in | Where to find it in the console |
|---|---|---|
| `ACCOUNT_ID` (12 digits) | your AWS account | Click your account name at the top right. Copy **Account ID**. |
| `AWS_REGION` | fixed | `ap-southeast-1` |
| `OIDC_ISSUER_URL` | `06-eks-cluster.md` | **EKS -> Clusters -> `ridenow-prod` -> Overview**. Copy **OpenID Connect provider URL**. |
| `OIDC_ID` (32 hex characters) | `06-eks-cluster.md` | Same page. It is the text after `/id/` in `OIDC_ISSUER_URL`. |
| `DB_SG_ID`, import `network-DbSecurityGroupId` | `02-network.md` | **EC2 -> Security Groups**. Search `ridenow-prod-db-sg`. Copy **Security group ID** (`sg-...`). |
| `REDIS_SG_ID`, import `messaging-RedisSecurityGroupId` | `05-messaging.md` | **EC2 -> Security Groups**. Search `ridenow-prod-redis-sg`. Copy **Security group ID**. |
| `EKS_CLUSTER_SG_ID`, import `eks-ClusterSecurityGroupId` | `06-eks-cluster.md` | **EKS -> Clusters -> `ridenow-prod` -> Networking**. Copy **Cluster security group** (`sg-...`, named `eks-cluster-sg-ridenow-prod-<number>`). |
| Trip messaging policy, import `iam-TripServiceMessagingPolicyArn` | `01-iam.md` | **IAM -> Policies**. Search `ridenow-prod-trip-service-messaging`. Open it and copy the ARN. |
| Payment messaging policy, import `iam-PaymentServiceMessagingPolicyArn` | `01-iam.md` | **IAM -> Policies**. Search `ridenow-prod-payment-service-messaging`. Open it and copy the ARN. |
| Matching messaging policy, import `iam-MatchingServiceMessagingPolicyArn` | `01-iam.md` | **IAM -> Policies**. Search `ridenow-prod-matching-service-messaging`. Open it and copy the ARN. |
| Notification messaging policy, import `iam-NotificationWorkerMessagingPolicyArn` | `01-iam.md` | **IAM -> Policies**. Search `ridenow-prod-notification-worker-messaging`. Open it and copy the ARN. |
| ADOT Collector X-Ray policy, import `iam-AdotCollectorXRayPolicyArn` | `01-iam.md` | **IAM -> Policies**. Search `ridenow-prod-adot-collector-xray`. Open it and copy the ARN. |
| `ADOT_COLLECTOR_TAG` | fixed | `v0.51.0`, the pinned tag of `public.ecr.aws/aws-observability/aws-otel-collector` that `iac/scripts/deploy-and-test.sh` uses by default. |
| `ADOT_COLLECTOR_ROLE_ARN` | this guide, step 5 | **IAM -> Roles -> `ridenow-prod-adot-collector`**. Copy **ARN**. Look it up after step 5. |
| `USER_DB_ENDPOINT`, `DRIVER_DB_ENDPOINT`, `TRIP_DB_ENDPOINT`, `PAYMENT_DB_ENDPOINT`, `MATCHING_DB_ENDPOINT`, `NOTIFICATION_DB_ENDPOINT` | `04-data.md` | **RDS -> Databases -> `ridenow-prod-<service>-db`** (`user`, `driver`, `trip`, `payment`, `matching`, `notification`) **-> Connectivity & security**. Copy **Endpoint** (host name only, no port). |
| `REDIS_ENDPOINT` | `05-messaging.md` | **ElastiCache -> Valkey caches** (or **Redis OSS caches**) **-> `ridenow-prod-redis`**. Copy **Primary endpoint** (host name only, no `:6379`). |
| `MATCHING_QUEUE_URL` | `05-messaging.md` | **SQS -> Queues -> `ridenow-prod-matching`**. Copy **URL**. |
| `PAYMENT_QUEUE_URL` | `05-messaging.md` | **SQS -> Queues -> `ridenow-prod-payment`**. Copy **URL**. |
| `NOTIFICATIONS_QUEUE_URL` | `05-messaging.md` | **SQS -> Queues -> `ridenow-prod-notifications`**. Copy **URL**. |
| Events topic `ridenow-prod-events` | `05-messaging.md` | **SNS -> Topics -> `ridenow-prod-events`**. Check that it exists. The manifests build its ARN from `AWS_REGION` and `ACCOUNT_ID`, so you paste nothing. |
| `IMAGE_TAG` | `03-ecr.md` | **ECR -> Private repositories -> `ridenow/user-service` -> Image tags**. Use the tag you pushed, for example `v1.0.0`. |
| `APP_ORIGIN` | `08-frontend.md` | **CloudFront -> Distributions**. Copy **Distribution domain name** of `RideNow prod frontend` and prefix `https://`. If you have not created it yet, use `https://app.example.com` and re-apply later. |
| `TRIP_SERVICE_ROLE_ARN`, `PAYMENT_SERVICE_ROLE_ARN`, `MATCHING_SERVICE_ROLE_ARN`, `NOTIFICATION_WORKER_ROLE_ARN` | this guide, step 4 | **IAM -> Roles -> `ridenow-prod-<service>`**. Copy **ARN**. Look these up after step 4. |

## Create the resources

Create in this order. The roles need the OIDC provider.

### 1. Inbound rule: PostgreSQL from the Fargate pods (`DbIngressFromFargatePods`)

1. Go to **EC2 -> Security Groups**.
2. Search for `ridenow-prod-db-sg` and select it (`DB_SG_ID`).
3. Open the **Inbound rules** tab and choose **Edit inbound rules -> Add rule**.
4. Set **Type** to `PostgreSQL` (this fills **Protocol** `TCP` and **Port range** `5432`).
5. Set **Source** to `Custom`.
6. In the search box paste `EKS_CLUSTER_SG_ID` (`sg-...`) and pick the group `eks-cluster-sg-ridenow-prod-<number>`.
7. Set **Description** to `PostgreSQL 5432 from the EKS cluster security group (Fargate pods)`.
8. Choose **Save rules**.

Expected: the group has two rules on 5432, the one from `02-network.md` and this one. No tags.

### 2. Inbound rule: Redis from the Fargate pods (`RedisIngressFromFargatePods`)

1. Go to **EC2 -> Security Groups**.
2. Search for `ridenow-prod-redis-sg` and select it (`REDIS_SG_ID`).
3. Open the **Inbound rules** tab and choose **Edit inbound rules -> Add rule**.
4. Set **Type** to `Custom TCP`.
5. Set **Port range** to `6379`.
6. Set **Source** to `Custom`.
7. Paste `EKS_CLUSTER_SG_ID` and pick `eks-cluster-sg-ridenow-prod-<number>`.
8. Set **Description** to `Redis 6379 from the EKS cluster security group (Fargate pods)`.
9. Choose **Save rules**.

Expected: the group has two rules on 6379. No tags.

### 3. OIDC identity provider (`OidcProvider`)

`OIDC_ISSUER_URL` has the form `https://oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>` (32 hex characters). If the cluster page shows no such URL, the cluster does not exist yet (`06-eks-cluster.md`).

1. Go to **IAM -> Identity providers -> Add provider**.
2. Set **Provider type** to `OpenID Connect`.
3. Paste `OIDC_ISSUER_URL` into **Provider URL**.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Get thumbprint**. The console fills `9e99a48a9960b14926bb7f3b02e22da2b0ab7280`, which is the value the Template uses.
6. Choose **Add provider**.

Expected: the provider is listed with that URL. No tags.

### 4. Six IRSA roles

Every role policy below contains two placeholders. Before you paste a policy, replace them with the values from the Depends on table:

- `<ACCOUNT_ID>`: `ACCOUNT_ID` (12 digits).
- `<OIDC_ID>`: `OIDC_ID` (32 hex characters).

Create the roles one at a time, in the order below.

#### 4.1 Role `ridenow-prod-alb-controller`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-alb-controller` |
| Service account | `kube-system:aws-load-balancer-controller` |
| Permissions | none at creation |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, tick no policy, then choose **Next**.
7. Set **Role name** to `ridenow-prod-alb-controller`.
8. Leave **Description** blank.
9. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-alb-controller` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:kube-system:aws-load-balancer-controller",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-alb-controller` exists. Trust relationships shows the OIDC provider as principal and `kube-system:aws-load-balancer-controller` in the condition.

#### 4.2 Role `ridenow-prod-external-secrets`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-external-secrets` |
| Service account | `external-secrets:external-secrets` |
| Permissions | inline policy `read-ridenow-secrets` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, tick no policy, then choose **Next**.
7. Set **Role name** to `ridenow-prod-external-secrets`.
8. Leave **Description** blank.
9. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-external-secrets` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the trust policy JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

**Add the inline policy**

1. Open the **Permissions** tab.
2. Choose **Add permissions -> Create inline policy**.
3. Choose the **JSON** tab.
4. Delete the whole document.
5. Paste the inline policy JSON below, with `<ACCOUNT_ID>` replaced.
6. Choose **Next**.
7. Set **Policy name** to `read-ridenow-secrets`.
8. Choose **Create policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:external-secrets:external-secrets",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Inline policy `read-ridenow-secrets`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:<ACCOUNT_ID>:secret:ridenow-prod-*",
        "arn:aws:secretsmanager:*:<ACCOUNT_ID>:secret:rds!db-*"
      ]
    }
  ]
}
```

Expected: role `ridenow-prod-external-secrets` exists. Trust relationships shows the OIDC provider as principal and `external-secrets:external-secrets` in the condition.

#### 4.3 Role `ridenow-prod-trip-service`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-trip-service` |
| Service account | `ridenow:trip-service` |
| Permissions | managed policy `ridenow-prod-trip-service-messaging` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, set the filter to `Customer managed`.
7. Search for `ridenow-prod-trip-service-messaging`.
8. Tick the checkbox of that policy, then choose **Next**.
9. Set **Role name** to `ridenow-prod-trip-service`.
10. Leave **Description** blank.
11. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-trip-service` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:ridenow:trip-service",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-trip-service` exists. Trust relationships shows the OIDC provider as principal and `ridenow:trip-service` in the condition.

#### 4.4 Role `ridenow-prod-payment-service`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-payment-service` |
| Service account | `ridenow:payment-service` |
| Permissions | managed policy `ridenow-prod-payment-service-messaging` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, set the filter to `Customer managed`.
7. Search for `ridenow-prod-payment-service-messaging`.
8. Tick the checkbox of that policy, then choose **Next**.
9. Set **Role name** to `ridenow-prod-payment-service`.
10. Leave **Description** blank.
11. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-payment-service` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:ridenow:payment-service",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-payment-service` exists. Trust relationships shows the OIDC provider as principal and `ridenow:payment-service` in the condition.

#### 4.5 Role `ridenow-prod-matching-service`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-matching-service` |
| Service account | `ridenow:matching-service` |
| Permissions | managed policy `ridenow-prod-matching-service-messaging` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, set the filter to `Customer managed`.
7. Search for `ridenow-prod-matching-service-messaging`.
8. Tick the checkbox of that policy, then choose **Next**.
9. Set **Role name** to `ridenow-prod-matching-service`.
10. Leave **Description** blank.
11. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-matching-service` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:ridenow:matching-service",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-matching-service` exists. Trust relationships shows the OIDC provider as principal and `ridenow:matching-service` in the condition.

#### 4.6 Role `ridenow-prod-notification-worker`

| Item | Value |
|---|---|
| Role name | `ridenow-prod-notification-worker` |
| Service account | `ridenow:notification-worker` |
| Permissions | managed policy `ridenow-prod-notification-worker-messaging` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, set the filter to `Customer managed`.
7. Search for `ridenow-prod-notification-worker-messaging`.
8. Tick the checkbox of that policy, then choose **Next**.
9. Set **Role name** to `ridenow-prod-notification-worker`.
10. Leave **Description** blank.
11. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-notification-worker` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:ridenow:notification-worker",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-notification-worker` exists. Trust relationships shows the OIDC provider as principal and `ridenow:notification-worker` in the condition.

`user-service`, `driver-service` and `realtime-gateway` have no role.

### 5. Role `ridenow-prod-adot-collector` (`AdotCollectorRole`)

The ADOT Collector is the only workload that writes to X-Ray. The services send OTLP to it and have no X-Ray permissions.

| Item | Value |
|---|---|
| Role name | `ridenow-prod-adot-collector` |
| Service account | `ridenow:adot-collector` |
| Permissions | managed policy `ridenow-prod-adot-collector-xray` |

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Web identity`.
3. Set **Identity provider** to `oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.
4. Set **Audience** to `sts.amazonaws.com`.
5. Choose **Next**.
6. On **Add permissions**, set the filter to `Customer managed`.
7. Search for `ridenow-prod-adot-collector-xray`.
8. Tick the checkbox of that policy, then choose **Next**.
9. Set **Role name** to `ridenow-prod-adot-collector`.
10. Leave **Description** blank.
11. Choose **Create role**.

**Replace the trust policy**

1. In the roles list, search for `ridenow-prod-adot-collector` and open it.
2. Open the **Trust relationships** tab and choose **Edit trust policy**.
3. Delete the whole document.
4. Paste the JSON below, with `<ACCOUNT_ID>` and `<OIDC_ID>` replaced.
5. Choose **Update policy**.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:sub": "system:serviceaccount:ridenow:adot-collector",
          "oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

Expected: role `ridenow-prod-adot-collector` exists with the one policy `ridenow-prod-adot-collector-xray`. Trust relationships shows the OIDC provider as principal and `ridenow:adot-collector` in the condition. Copy its ARN as `ADOT_COLLECTOR_ROLE_ARN`.

## Values to record

After you create the roles, copy each ARN from the console (**IAM -> Roles**, open the role, copy **ARN**) and keep it under the value name below.

| Output_Equivalent (Template export) | Where it comes from | Value name | Used by |
|---|---|---|---|
| `AlbControllerRoleArn` | IAM > Roles > `ridenow-prod-alb-controller` > ARN | `ALB_CONTROLLER_ROLE_ARN` | [06-eks-cluster.md](06-eks-cluster.md#3-aws-load-balancer-controller) |
| `ExternalSecretsRoleArn` | IAM > Roles > `ridenow-prod-external-secrets` > ARN | `EXTERNAL_SECRETS_ROLE_ARN` | [06-eks-cluster.md](06-eks-cluster.md#4-external-secrets-operator) |
| `TripServiceRoleArn` | IAM > Roles > `ridenow-prod-trip-service` > ARN | `TRIP_SERVICE_ROLE_ARN` | `iac/k8s/22-trip-service.yaml` |
| `PaymentServiceRoleArn` | IAM > Roles > `ridenow-prod-payment-service` > ARN | `PAYMENT_SERVICE_ROLE_ARN` | `iac/k8s/23-payment-service.yaml` |
| `MatchingServiceRoleArn` | IAM > Roles > `ridenow-prod-matching-service` > ARN | `MATCHING_SERVICE_ROLE_ARN` | `iac/k8s/24-matching-service.yaml` |
| `NotificationWorkerRoleArn` | IAM > Roles > `ridenow-prod-notification-worker` > ARN | `NOTIFICATION_WORKER_ROLE_ARN` | `iac/k8s/25-notification-worker.yaml` |
| `AdotCollectorRoleArn` | IAM > Roles > `ridenow-prod-adot-collector` > ARN | `ADOT_COLLECTOR_ROLE_ARN` | `iac/k8s/15-adot-collector.yaml` |

## Post-Deploy

Run from the repository root in a bash shell. Prerequisites: images for your `IMAGE_TAG` in ECR (`03-ecr.md`); kubeconfig, `ridenow` namespace and database secrets (`06-eks-cluster.md`); ALB controller and External Secrets installed ([06-eks-cluster.md](06-eks-cluster.md#3-aws-load-balancer-controller) and 4.2).

`APP_ORIGIN` is the browser origin allowed to call the API (never `*`).

**Assign the values.** Replace every `<paste>` with the value from the Depends on table. Keep the quotes and paste the value only.

```bash
ACCOUNT_ID="<paste>"
AWS_REGION=ap-southeast-1
ENV=prod
IMAGE_TAG="<paste>"
APP_ORIGIN="<paste>"
REDIS_ENDPOINT="<paste>"
USER_DB_ENDPOINT="<paste>"
DRIVER_DB_ENDPOINT="<paste>"
TRIP_DB_ENDPOINT="<paste>"
PAYMENT_DB_ENDPOINT="<paste>"
MATCHING_DB_ENDPOINT="<paste>"
NOTIFICATION_DB_ENDPOINT="<paste>"
MATCHING_QUEUE_URL="<paste>"
PAYMENT_QUEUE_URL="<paste>"
NOTIFICATIONS_QUEUE_URL="<paste>"
TRIP_SERVICE_ROLE_ARN="<paste>"
PAYMENT_SERVICE_ROLE_ARN="<paste>"
MATCHING_SERVICE_ROLE_ARN="<paste>"
NOTIFICATION_WORKER_ROLE_ARN="<paste>"
ADOT_COLLECTOR_ROLE_ARN="<paste>"
ADOT_COLLECTOR_TAG=v0.51.0
for V in ACCOUNT_ID IMAGE_TAG APP_ORIGIN REDIS_ENDPOINT USER_DB_ENDPOINT DRIVER_DB_ENDPOINT \
         TRIP_DB_ENDPOINT PAYMENT_DB_ENDPOINT MATCHING_DB_ENDPOINT NOTIFICATION_DB_ENDPOINT \
         MATCHING_QUEUE_URL PAYMENT_QUEUE_URL NOTIFICATIONS_QUEUE_URL TRIP_SERVICE_ROLE_ARN \
         PAYMENT_SERVICE_ROLE_ARN MATCHING_SERVICE_ROLE_ARN NOTIFICATION_WORKER_ROLE_ARN ADOT_COLLECTOR_ROLE_ARN; do
  case "${!V}" in ""|"<paste>") echo "NOT SET: $V" ;; esac
done
```

Expected: no `NOT SET:` line. If one appears, look the value up in the Depends on table and assign it again.

**Build the substitution list.** The `sed` commands in the next block use it.

```bash
SUBST=(
  -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g"
  -e "s|<REGION>|$AWS_REGION|g"
  -e "s|<ENV>|$ENV|g"
  -e "s|<IMAGE_TAG>|$IMAGE_TAG|g"
  -e "s|<APP_ORIGIN>|$APP_ORIGIN|g"
  -e "s|<REDIS_ENDPOINT>|$REDIS_ENDPOINT|g"
  -e "s|<USER_DB_ENDPOINT>|$USER_DB_ENDPOINT|g"
  -e "s|<DRIVER_DB_ENDPOINT>|$DRIVER_DB_ENDPOINT|g"
  -e "s|<TRIP_DB_ENDPOINT>|$TRIP_DB_ENDPOINT|g"
  -e "s|<PAYMENT_DB_ENDPOINT>|$PAYMENT_DB_ENDPOINT|g"
  -e "s|<MATCHING_DB_ENDPOINT>|$MATCHING_DB_ENDPOINT|g"
  -e "s|<NOTIFICATION_DB_ENDPOINT>|$NOTIFICATION_DB_ENDPOINT|g"
  -e "s|<MATCHING_QUEUE_URL>|$MATCHING_QUEUE_URL|g"
  -e "s|<PAYMENT_QUEUE_URL>|$PAYMENT_QUEUE_URL|g"
  -e "s|<NOTIFICATIONS_QUEUE_URL>|$NOTIFICATIONS_QUEUE_URL|g"
  -e "s|<TRIP_SERVICE_ROLE_ARN>|$TRIP_SERVICE_ROLE_ARN|g"
  -e "s|<PAYMENT_SERVICE_ROLE_ARN>|$PAYMENT_SERVICE_ROLE_ARN|g"
  -e "s|<MATCHING_SERVICE_ROLE_ARN>|$MATCHING_SERVICE_ROLE_ARN|g"
  -e "s|<NOTIFICATION_WORKER_ROLE_ARN>|$NOTIFICATION_WORKER_ROLE_ARN|g"
  -e "s|<ADOT_COLLECTOR_ROLE_ARN>|$ADOT_COLLECTOR_ROLE_ARN|g"
  -e "s|<ADOT_COLLECTOR_TAG>|$ADOT_COLLECTOR_TAG|g"
)
```

**Deploy the ADOT Collector first.** The services send traces to it, so apply `iac/k8s/15-adot-collector.yaml` before the service manifests. It creates the ServiceAccount `adot-collector`, its ConfigMap, a Deployment with two replicas, the ClusterIP Service `adot-collector` (ports 4317 and 4318) and a PodDisruptionBudget.

```bash
sed "${SUBST[@]}" iac/k8s/15-adot-collector.yaml | kubectl apply -f -
kubectl rollout status deployment/adot-collector -n ridenow --timeout=900s
kubectl get pods -n ridenow -l app=adot-collector
kubectl logs -n ridenow deployment/adot-collector --tail=50
```

Expected: `deployment "adot-collector" successfully rolled out`, then two pods `1/1 Running`. The logs show the Collector starting (`Everything is ready. Begin running and processing data.`) and no `AccessDenied`, `WebIdentityErr`, `NoCredentialProviders` or `failed to export` lines. If a pod stays `Pending`, wait: Fargate starts a node per pod. If the logs show `AccessDenied` or `WebIdentityErr`, check that the role trust policy names `system:serviceaccount:ridenow:adot-collector`, that the policy `ridenow-prod-adot-collector-xray` is attached, and that `kubectl get sa adot-collector -n ridenow -o yaml` shows the `eks.amazonaws.com/role-arn` annotation with your role ARN. Then restart with `kubectl rollout restart deployment/adot-collector -n ridenow`.

Deploy in this order (payment before trip, driver before matching). Fargate starts a node per pod, so each rollout can take several minutes.

```bash
for F in 23-payment-service 20-user-service 21-driver-service 22-trip-service \
         24-matching-service 25-notification-worker 26-realtime-gateway; do
  sed "${SUBST[@]}" iac/k8s/$F.yaml | kubectl apply -f -
  kubectl rollout status deployment/${F#*-} -n ridenow --timeout=900s
done
```

Expected: seven `deployment "<service>" successfully rolled out` lines. If a rollout fails, run `kubectl describe pod -n ridenow -l app=<service>` and `kubectl logs -n ridenow deployment/<service> --tail=50`. Timeouts to PostgreSQL or Redis mean the inbound rules from steps 1 and 2 or the `SecurityGroupPolicy` from `06-eks-cluster.md` are missing.

## Verify

Assign the values from the Depends on table, then run the checks. Needs the AWS CLI, `jq` and `kubectl`.

```bash
export AWS_DEFAULT_REGION=ap-southeast-1 AWS_PAGER=""
ENV=prod
OIDC_ID="<paste>"
DB_SG_ID="<paste>"
REDIS_SG_ID="<paste>"
EKS_CLUSTER_SG_ID="<paste>"
aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, '$OIDC_ID')].Arn" --output text
aws ec2 describe-security-groups --group-ids "$DB_SG_ID" --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].UserIdGroupPairs[].GroupId" --output text
aws ec2 describe-security-groups --group-ids "$REDIS_SG_ID" --query "SecurityGroups[0].IpPermissions[?FromPort==\`6379\`].UserIdGroupPairs[].GroupId" --output text
echo "cluster SG: $EKS_CLUSTER_SG_ID"
for ROLE in alb-controller external-secrets trip-service payment-service matching-service notification-worker adot-collector; do
  aws iam get-role --role-name ridenow-$ENV-$ROLE --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals' --output json \
    | jq -r --arg r "$ROLE" 'to_entries[] | select(.key | endswith(":sub")) | "\($r)  \(.value)"'
done
kubectl get pods -n ridenow
kubectl logs -n ridenow deployment/adot-collector --tail=50 | grep -iE "error|accessdenied|failed" || echo "no collector errors"
```

Expected: one provider ARN ending in `/id/<OIDC_ID>`. Both group lines contain the `cluster SG:` value. Seven role lines, each with its `system:serviceaccount:<namespace>:<service account>` from the table in steps 4 and 5 (`adot-collector` shows `ridenow:adot-collector`). `no collector errors`. 15 pods `1/1 Running` (two each for `user-service`, `driver-service`, `trip-service`, `payment-service`, `matching-service`, `realtime-gateway`; one `notification-worker`), and two `adot-collector` pods (15 in total).

Next: continue with `08-frontend.md` once the Ingress has an ALB address.
