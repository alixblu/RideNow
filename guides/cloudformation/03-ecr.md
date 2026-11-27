# 03 - ECR (container registry)

Create seven private ECR repositories by hand (source: `iac/stacks/03-ecr.yaml`, `iac/params/prod.json`; nothing is deployed). Values: `MaxImageCount` = `50`, `UntaggedExpireDays` = `14`.

## What it creates

| Template logical ID | AWS resource type | Repository name (Resolved_Value) |
|---|---|---|
| `UserServiceRepo` | `AWS::ECR::Repository` | `ridenow/user-service` |
| `DriverServiceRepo` | `AWS::ECR::Repository` | `ridenow/driver-service` |
| `TripServiceRepo` | `AWS::ECR::Repository` | `ridenow/trip-service` |
| `PaymentServiceRepo` | `AWS::ECR::Repository` | `ridenow/payment-service` |
| `MatchingServiceRepo` | `AWS::ECR::Repository` | `ridenow/matching-service` |
| `NotificationWorkerRepo` | `AWS::ECR::Repository` | `ridenow/notification-worker` |
| `RealtimeGatewayRepo` | `AWS::ECR::Repository` | `ridenow/realtime-gateway` |

## Depends on

No earlier guide is needed. Look up these values yourself before the Post-Deploy and Verify steps:

| Value | Where to find it in the console |
|---|---|
| Account ID | Top-right account menu (the 12-digit number) |
| Region | Top-right region selector: `ap-southeast-1` (Asia Pacific (Singapore)) |
| Image tag | `v1.0.0` |

## Create the resources

Region: Asia Pacific (Singapore) ap-southeast-1. Each repository below has its own complete block. Do them one after another.
Note: if the create page has no Scan on push option, turn it on after creating: ECR -> Private registry -> Settings -> Scanning configuration -> Basic scanning, Scan on push for filter `ridenow/*`.

### 1. ridenow/user-service (`UserServiceRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/user-service` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/user-service`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 2. ridenow/driver-service (`DriverServiceRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/driver-service` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/driver-service`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 3. ridenow/trip-service (`TripServiceRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/trip-service` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/trip-service`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 4. ridenow/payment-service (`PaymentServiceRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/payment-service` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/payment-service`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 5. ridenow/matching-service (`MatchingServiceRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/matching-service` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/matching-service`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 6. ridenow/notification-worker (`NotificationWorkerRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/notification-worker` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/notification-worker`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

### 7. ridenow/realtime-gateway (`RealtimeGatewayRepo`)

**Create the repository**

1. Go to **ECR -> Private registry -> Repositories -> Create repository**.
2. Set **Visibility settings** to `Private`.
3. In **Repository name**, type `ridenow/realtime-gateway` (type the slash as part of the name).
4. Set **Image tag mutability** to `Immutable`.
5. Tick **Customize encryption settings (KMS)** under **Encryption settings**.
6. Set **Encryption key** to `AWS managed key (aws/ecr)`.
7. Under **Image scan settings**, set **Scan on push** to `Enabled`.
8. Choose **Create repository**.

**Lifecycle rule 1**

9. Open `ridenow/realtime-gateway`, then choose **Lifecycle Policy** in the left menu.
10. Choose **Create rule**.
11. Set **Rule priority** to `1`.
12. Set **Rule description** to `Expire untagged images`.
13. Set **Image status** to `Untagged`.
14. Under **Match criteria**, set **Since image pushed** with **Days** `14`.
15. Set **Rule action** to `expire`.
16. Choose **Save**.

**Lifecycle rule 2**

17. Choose **Create rule** again.
18. Set **Rule priority** to `2`.
19. Set **Rule description** to `Keep only the most recent tagged images`.
20. Set **Image status** to `Any`.
21. Under **Match criteria**, set **Image count more than** with **Count** `50`.
22. Set **Rule action** to `expire`.
23. Choose **Save**.

## Values to record

Each value is the repository URI: ECR -> Private registry -> Repositories -> URI column. Form: `<account-id>.dkr.ecr.<region>.amazonaws.com/<repository name>`. Account ID and Region are in the table under "Depends on".

| Output_Equivalent | Resource | Value | Consumed by |
|---|---|---|---|
| `UserServiceRepoUri` | `UserServiceRepo` | `<account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/user-service` | Post-Deploy below; image references in `iac/k8s/` (see the service deploy in `07-eks-addons.md`) |
| `DriverServiceRepoUri` | `DriverServiceRepo` | `.../ridenow/driver-service` | same |
| `TripServiceRepoUri` | `TripServiceRepo` | `.../ridenow/trip-service` | same |
| `PaymentServiceRepoUri` | `PaymentServiceRepo` | `.../ridenow/payment-service` | same |
| `MatchingServiceRepoUri` | `MatchingServiceRepo` | `.../ridenow/matching-service` | same |
| `NotificationWorkerRepoUri` | `NotificationWorkerRepo` | `.../ridenow/notification-worker` | same |
| `RealtimeGatewayRepoUri` | `RealtimeGatewayRepo` | `.../ridenow/realtime-gateway` | same |

## Post-Deploy

Replace `<from the table>` with your 12-digit Account ID, then run from the repository root.

```bash
ACCOUNT_ID=<from the table>
AWS_DEFAULT_REGION=ap-southeast-1
IMAGE_TAG=v1.0.0
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  docker buildx build --platform linux/amd64 \
    -t "$REGISTRY/ridenow/$SVC:$IMAGE_TAG" \
    --push "./$SVC"
done
```

Expected: `Login Succeeded`, then seven pushes. Tags are immutable: to push again, use a new `IMAGE_TAG`.

## Verify

```bash
AWS_DEFAULT_REGION=ap-southeast-1
aws ecr describe-repositories \
  --query "repositories[?starts_with(repositoryName,'ridenow/')].[repositoryName,imageScanningConfiguration.scanOnPush,encryptionConfiguration.encryptionType,imageTagMutability]" \
  --output table
```

Expected: seven rows, each `True`, `KMS`, `IMMUTABLE`. Otherwise recreate the empty repository (encryption is fixed at creation).

```bash
AWS_DEFAULT_REGION=ap-southeast-1
aws ecr get-lifecycle-policy --repository-name ridenow/user-service \
  --query lifecyclePolicyText --output text | jq '.rules[] | {rulePriority, countNumber: .selection.countNumber}'
```

Expected: priority 1 with `14`, priority 2 with `50`.

Next: `04-data.md`.

