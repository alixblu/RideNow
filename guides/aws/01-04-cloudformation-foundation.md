# 01-04 - Foundation via CloudFormation (IAM, VPC, ECR, RDS)

Goal: bring up the network, roles, image registries, and the **six databases
(one per service)** — using CloudFormation. No clicking for this part, and
nothing to create by hand afterwards.

Time: ~25 min (RDS creation is the slow part). Cost: NAT gateways + six
`db.t4g.micro` instances bill hourly; see Clean up.

---

## What this deploys and why

The lab is designed to prove **three interaction patterns** end-to-end on EKS:

| Pattern | Services involved | DBs needed |
|---------|-------------------|------------|
| 1 - Service-to-service HTTP | driver calls user-service to verify a user exists before creating a driver | **user-db**, **driver-db** |
| 2 - Service → SNS → SQS → worker | trip/payment emit events after commit; notification-worker consumes them once, with retry and DLQ | **trip-db**, **payment-db**, **notification-db** |
| 3 - SNS fan-out | `trip.completed` + `payment.succeeded` land on the same SQS queue; the worker processes both — one topic, multiple event types, one consumer | same trip-db + payment-db |

**matching-service has its own database too** (`matching_service`). Its Redis GEO
index answers "nearby drivers"; the database stores the offers it makes.
realtime-gateway is the only service with no database.

### Stacks 01-04

| Stack | Template | Creates |
|-------|----------|---------|
| 01-iam | `iac/stacks/01-iam.yaml` | EKS cluster role, Fargate pod execution role, scoped policies |
| 02-network | `iac/stacks/02-network.yaml` | VPC, subnets (3 AZ), IGW, one NAT per AZ, SGs |
| 03-ecr | `iac/stacks/03-ecr.yaml` | ECR repos for user/driver/trip/payment/matching/notification/realtime-gateway |
| **04-data** | **`iac/stacks/04-data.yaml`** | Six RDS instances (user/driver/trip/payment/matching/notification) with Secrets Manager credentials. Multi-AZ follows `MultiAz` in the params file |

All four stacks use the standard `iac/stacks/` templates. Stack 04 parameters
are controlled by `iac/params/dev.json` — the defaults there use `MultiAz: false`
for dev. To enable Multi-AZ, set `MultiAz=true` in the deploy command or update
`dev.json`.

---

## 1. Dry run first (creates nothing)

> **Note:** `aws cloudformation deploy --no-execute-changeset` times out if your
> account has the Early Validation hook enabled — the CLI waiter gives up before
> the hook finishes, and reports a false `FAILED` even though the changeset is
> fine. Use `create-change-set` + `--no-cli-pager` instead; it waits long enough
> and never blocks output in the pager.

```bash
export AWS_PAGER=""   # disable the less pager for this session
cd iac

# Stacks 01-03 — create changesets only (no execute):
for layer in 01-iam 02-network 03-ecr; do
  # Build the --parameters list from dev.json for this layer
  params=$(jq -r --arg l "$layer" \
    '.[$l] // {} | to_entries | map("ParameterKey=\(.key),ParameterValue=\(.value)") | join(" ")' \
    params/dev.json)
  aws cloudformation create-change-set \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --template-body "file://stacks/$layer.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --change-set-type CREATE \
    --change-set-name "ridenow-dev-$layer-dryrun" \
    --parameters $params \
    --no-cli-pager
  aws cloudformation wait change-set-create-complete \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --change-set-name "ridenow-dev-$layer-dryrun" \
    --no-cli-pager
  echo "=== $layer changeset ready ==="
  aws cloudformation describe-change-set \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --change-set-name "ridenow-dev-$layer-dryrun" \
    --query "[Status,StatusReason,Changes[*].ResourceChange.[Action,ResourceType,LogicalResourceId]]" \
    --output json \
    --no-cli-pager
done

# Stack 04 uses the standard iac/ template:
params=$(jq -r '."04-data" // {} | to_entries | map("ParameterKey=\(.key),ParameterValue=\(.value)") | join(" ")' \
  params/dev.json)
aws cloudformation create-change-set \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --template-body file://stacks/04-data.yaml \
  --change-set-type CREATE \
  --change-set-name ridenow-dev-04-data-dryrun \
  --parameters $params \
  --no-cli-pager
aws cloudformation wait change-set-create-complete \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --change-set-name ridenow-dev-04-data-dryrun \
  --no-cli-pager
aws cloudformation describe-change-set \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --change-set-name ridenow-dev-04-data-dryrun \
  --query "[Status,StatusReason,Changes[*].ResourceChange.[Action,ResourceType,LogicalResourceId]]" \
  --output json \
  --no-cli-pager
```

Review the change lists. When they look right, move to step 2.

---

## 2. Deploy stacks 01-03 (from iac/)

> `aws cloudformation deploy` has the same Early Validation waiter issue on
> accounts with hooks. Use the explicit changeset flow instead.

```bash
export AWS_PAGER=""
cd iac
for layer in 01-iam 02-network 03-ecr; do
  params=$(jq -r --arg l "$layer" \
    '.[$l] // {} | to_entries | map("ParameterKey=\(.key),ParameterValue=\(.value)") | join(" ")' \
    params/dev.json)

  # Create changeset
  aws cloudformation create-change-set \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --template-body "file://stacks/$layer.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --change-set-type CREATE \
    --change-set-name "ridenow-dev-$layer-deploy" \
    --parameters $params \
    --no-cli-pager

  # Wait for Early Validation hook to finish
  aws cloudformation wait change-set-create-complete \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --change-set-name "ridenow-dev-$layer-deploy" \
    --no-cli-pager

  # Execute
  aws cloudformation execute-change-set \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --change-set-name "ridenow-dev-$layer-deploy" \
    --no-cli-pager

  # Wait for stack to finish
  aws cloudformation wait stack-create-complete \
    --region ap-southeast-1 \
    --stack-name "ridenow-dev-$layer" \
    --no-cli-pager
  echo "ridenow-dev-$layer: CREATE_COMPLETE"
done
```

Each stack is fully up before the next one starts (important because 03-ecr may
import exports from 02-network).

---

## 3. Deploy stack 04 (from iac/)

```bash
cd iac
params=$(jq -r '."04-data" // {} | to_entries | map("ParameterKey=\(.key),ParameterValue=\(.value)") | join(" ")' \
  params/dev.json)

aws cloudformation create-change-set \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --template-body file://stacks/04-data.yaml \
  --change-set-type CREATE \
  --change-set-name ridenow-dev-04-data-deploy \
  --parameters $params \
  --no-cli-pager

aws cloudformation wait change-set-create-complete \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --change-set-name ridenow-dev-04-data-deploy \
  --no-cli-pager

aws cloudformation execute-change-set \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --change-set-name ridenow-dev-04-data-deploy \
  --no-cli-pager

aws cloudformation wait stack-create-complete \
  --region ap-southeast-1 \
  --stack-name ridenow-dev-04-data \
  --no-cli-pager

echo "ridenow-dev-04-data: CREATE_COMPLETE"
```

Six RDS instances create in parallel and take 10-20 minutes in total. If it fails with
`Cannot find version ...`, confirm `EngineVersion=17` was passed — never pin a
specific minor like `17.4` (AWS retires old minors and the stack will fail).

---

## 4. Read the exports

```bash
aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?starts_with(Name,'ridenow-dev-')].[Name,Value]" \
  --output table
```

Key exports the later steps use:

| Export | Used in |
|--------|---------|
| `ridenow-dev-network-VpcId` | EKS cluster (06), ALB controller (07) |
| `ridenow-dev-network-PrivateSubnetIds` | Fargate profiles, RDS subnet group |
| `ridenow-dev-network-PublicSubnetIds` | ALB |
| `ridenow-dev-network-NodeSecurityGroupId` | tighten Redis SG (08) |
| `ridenow-dev-iam-*RoleArn` | EKS cluster + node role (06) |
| `ridenow-dev-ecr-*RepoUri` | push images (05), k8s manifests (07) |
| `ridenow-dev-data-*DbEndpoint` | workload env in manifests (07) |
| `ridenow-dev-data-*DbSecretArn` | External Secrets / k8s Secrets (07) |

Get one value directly:

```bash
aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-data-TripDbEndpoint'].Value" \
  --output text
```

---

## 5. What the templates DON'T create — do these by hand

### Nothing is created by hand

All seven ECR repos are in `iac/stacks/03-ecr.yaml`, and all six databases are in
`iac/stacks/04-data.yaml`. The messaging layer (SNS, SQS, Redis) comes from stack
05, which is covered by `../../iac/README.md` and `00-deploy-runbook.md`.

---

## Verify

- CloudFormation console: `ridenow-dev-01-iam`, `02-network`, `03-ecr`,
  `04-data` all `CREATE_COMPLETE`.
- `aws cloudformation list-exports` shows the `ridenow-dev-*` exports above.
- ECR: seven repos (all from `03-ecr`: user/driver/trip/payment/matching/notification/realtime-gateway).
- RDS: six instances **Available**, all private, each with a Secrets Manager
  secret (user / driver / trip / payment / matching / notification).

---

## Clean up

Delete the ALB + EKS workloads first (they hold the VPC open), then:

```bash
# Delete the stacks in reverse order (teardown.sh walks 07 -> 01):
cd iac
./scripts/teardown.sh dev --apply
```

Next: `03-ecr.md` (build and push the images), then `05-eks-cluster.md`.
