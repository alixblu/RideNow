# RideNow - Infrastructure as Code (CloudFormation + EKS)

Production-grade, **layered** CloudFormation for the RideNow backend. This is the
"codify it" counterpart to the console-first AWS guides in `../guides/aws/`.
The console guides teach each AWS resource by hand; this folder reproduces the
same footprint as reviewable, repeatable templates.

> These templates provision the full architecture in `../docs/ARCHITECTURE.md`: a
> 2-AZ VPC, one RDS instance per data-owning service (six), SNS/SQS/Valkey, and an
> EKS cluster whose seven services run on **AWS
> Fargate** (serverless — no EC2 node groups to size, patch, or autoscale). Pods
> are scheduled by namespace-matched Fargate profiles and billed per vCPU/memory
> second while they run.

---

## What this provisions

| Layer | Template | Creates | Hardening |
|-------|----------|---------|-----------|
| 1 | `stacks/01-iam.yaml` | EKS cluster role, Fargate pod execution role, scoped ECR / Secrets policy, one messaging policy per service | Least privilege; each messaging policy names the exact queue / topic ARN its service uses |
| 2 | `stacks/02-network.yaml` | VPC, public + private subnets (2 AZs), IGW, one NAT per AZ, route tables, cluster SG, DB SG | Private subnets for workloads + data; DB SG allows 5432 only from the cluster SG |
| 3 | `stacks/03-ecr.yaml` | One repo per service: `ridenow/{user,driver,trip,payment,matching}-service`, `ridenow/notification-worker`, `ridenow/realtime-gateway` | Scan-on-push, KMS encryption, lifecycle expiry |
| 4 | `stacks/04-data.yaml` | Six RDS PostgreSQL instances, **one per service that owns data**: user, driver, trip, payment, matching, notification (realtime-gateway has none) | Multi-AZ per params, `StorageEncrypted` + KMS, private, credentials in Secrets Manager (generated, never in templates) |
| 5 | `stacks/05-messaging.yaml` | SNS topic; matching / payment / notifications SQS queues, each with a DLQ; one raw-delivery subscription per queue, filtered on the event `type`; ElastiCache for Valkey (Redis protocol; logical IDs keep the `Redis` name) | SQS queues encrypted; each queue policy admits only the RideNow topic (`aws:SourceArn`); the topic has no SSE because the AWS-managed `aws/sns` key blocks delivery to SQS; Valkey private with in-transit TLS |
| 6 | `stacks/06-eks-cluster.yaml` | EKS control plane + **Fargate profiles** (app, system, observability) — no EC2 node group | KMS secrets envelope-encryption, OIDC/IRSA, serverless pods on private subnets |
| 7 | `stacks/07-eks-addons.yaml` | IRSA roles for AWS Load Balancer Controller + External Secrets, and for trip / payment / matching / notification-worker | Gated; each role trusts only its own service account and carries only its service's messaging policy |

Kubernetes workload manifests (Deployment / Service / Ingress / HPA) live in `k8s/`.

### What each Kubernetes manifest needs

Each manifest has `<PLACEHOLDER>`s filled from stack exports (see
`../guides/aws/06-eks-deploy.md`). `scripts/check-consistency.sh` checks that every
one has a source.

| Manifest | Service | Database | Export-fed placeholders |
|----------|---------|----------|-------------------------|
| `10-external-secrets.yaml` | six `ExternalSecret`s | all six | `<*_SECRET_ARN>` from `04-data` |
| `20-user-service.yaml` | user-service :8081 | user | `<USER_DB_ENDPOINT>` |
| `21-driver-service.yaml` | driver-service :8080 | driver | `<DRIVER_DB_ENDPOINT>`, `<REDIS_ENDPOINT>` |
| `22-trip-service.yaml` | trip-service :8082 | trip | `<TRIP_DB_ENDPOINT>`, `<TRIP_SERVICE_ROLE_ARN>` |
| `23-payment-service.yaml` | payment-service :8083 | payment | `<PAYMENT_DB_ENDPOINT>`, `<PAYMENT_QUEUE_URL>`, `<PAYMENT_SERVICE_ROLE_ARN>` |
| `24-matching-service.yaml` | matching-service :8085 (internal) | matching | `<MATCHING_DB_ENDPOINT>`, `<REDIS_ENDPOINT>`, `<MATCHING_QUEUE_URL>`, `<MATCHING_SERVICE_ROLE_ARN>` |
| `25-notification-worker.yaml` | notification-worker :8084 | notification | `<NOTIFICATION_DB_ENDPOINT>`, `<REDIS_ENDPOINT>`, `<NOTIFICATIONS_QUEUE_URL>`, `<NOTIFICATION_WORKER_ROLE_ARN>` |
| `26-realtime-gateway.yaml` | realtime-gateway :8086 | none | `<REDIS_ENDPOINT>` |
| `30-ingress.yaml` | ALB: `/api/users`, `/api/drivers`, `/api/trips`, `/api/payments`, `/api/notifications`, `/live` | - | - |

---

## The one rule: layers deploy in order, wired by exports/imports

Each stack **exports** named outputs; the next stack **imports** them with
`Fn::ImportValue`. No stack reaches into another's internals. Deploy order is the
table order (01 -> 07); teardown is the reverse (07 -> 01).

### Export naming convention

Every cross-stack export is named:

```
ridenow-<env>-<layer>-<resource>
```

Examples:

```
ridenow-prod-network-VpcId
ridenow-prod-network-PrivateSubnetIds
ridenow-prod-network-NodeSecurityGroupId   # exports the cluster SG
ridenow-prod-network-DbSecurityGroupId
ridenow-prod-iam-ClusterRoleArn
ridenow-prod-iam-FargatePodExecutionRoleArn
ridenow-prod-ecr-UserServiceRepoUri
ridenow-prod-data-UserDbEndpoint
ridenow-prod-data-UserDbSecretArn
ridenow-prod-eks-ClusterName
ridenow-prod-eks-OidcProviderArn
```

`<env>` is one of `dev`, `staging`, `prod` and comes from the `Environment`
parameter, so three environments coexist in one account/region without clashing.

### Dependency flow

```
01-iam ─────────────┐
                    ├─> 06-eks-cluster (cluster role + Fargate pod execution role)
02-network ─────────┼─> 04-data        (private subnets, DB SG, KMS)
                    ├─> 05-messaging    (private subnets, SG)
                    └─> 06-eks-cluster (private subnets for Fargate profiles)
03-ecr ─────────────────> k8s/ manifests (image URIs)
04-data (secret ARNs) ──> k8s/ manifests (DB env wiring via External Secrets)
06-eks-cluster ─────────> 07-eks-addons (OIDC provider ARN)     [gated]
```

---

## Environments

Per-environment values live in `params/<env>.json` (CloudFormation parameter
files). The **same templates** deploy every environment. Each environment has the
same architecture (same stacks, same services); `dev` is sized down to cost less.
The `Environment` name and the VPC CIDR also differ so multiple environments can
coexist in one account/region.

| Knob | `dev` | `staging` / `prod` |
|------|-------|--------------------|
| AZ count / NAT gateways | 2 AZ, one NAT per AZ | same |
| RDS instances | 6 (one per data-owning service) | same |
| RDS instance class / storage | `db.t4g.micro`, 20 GiB | same |
| RDS Multi-AZ | false | true |
| RDS backup retention (days) | 1 | 30 |
| RDS deletion protection | false (snapshot on delete) | false (snapshot on delete) |
| Cache node type (`RedisNodeType`) | `cache.t4g.micro` | `cache.t4g.small` |
| EKS compute | **Fargate** (serverless pods; no node group, no autoscaler) | same |
| Messaging (SNS/SQS) | on | on |

This matches the recorded RideNow config decision: **one image promoted unchanged
across environments; the environment supplies the differences** (laptop defaults ->
Compose `.env` -> ConfigMap/Secret/Secrets Manager). No `dev`/`prod` baked into any
service image.

---

## Prerequisites

- AWS CLI v2 configured (`aws sts get-caller-identity` succeeds) as a non-root user
  (LEARNING_PATH Stage 7).
- Permission to create IAM roles, VPCs, RDS, EKS (incl. Fargate profiles), ECR,
  SNS/SQS, and ElastiCache.
- For template authoring/validation only: `cfn-lint` (`pip install cfn-lint`).
- For the Kubernetes layer: `kubectl` and (when a cluster exists) `aws eks
  update-kubeconfig`.

## Deploy
Run the static checks first. They call no AWS API and take a few seconds:
```bash
./scripts/check-consistency.sh
```
Then the deploy:

```bash
# Dry run (default, SAFE): emits a change set per layer, applies NOTHING.
./scripts/deploy.sh prod

# Apply for real (creates billable resources):
./scripts/deploy.sh prod --apply
# Apply, running independent stacks at the same time (about 30 min faster):
./scripts/deploy.sh prod --apply --parallel
```

`deploy.sh` walks stacks 01 -> 07 in order, feeding `params/<env>.json`, and waits
for each to reach a stable state before starting the next (because later layers
import earlier exports). With `--parallel` it runs three phases instead:
(01, 02, 03), then (04, 05, 06), then 07. Stacks inside a phase do not import from
each other. Re-running is safe: a stack with no changes is skipped, so an
interrupted run resumes where it stopped. If a first create fails, the stack is
left in `ROLLBACK_COMPLETE`; the script prints the failed events and stops, and
`RIDENOW_DELETE_ROLLBACK=1 ./scripts/deploy.sh <env> --apply` deletes that stack
and retries. Stack **07-eks-addons** needs the cluster's OIDC provider
id, which only exists after stack 06 — the script **resolves it automatically**
(`aws eks describe-cluster`) and injects it, so the whole infra half is one
command. (During a dry run before 06 exists the id can't be resolved; the script
warns and leaves it blank, which is harmless for the change-set preview.)

> This provisions **infrastructure only**. The image build, the in-cluster Helm /
> `kubectl` add-ons, and the service manifests are separate steps. Follow
> `../guides/aws/00-deploy-runbook.md` for the full dependency-ordered sequence
> (stacks + images + add-ons + services).

## Teardown

Two steps, in order. The in-cluster cleanup runs **first** — the ALB created by
the Ingress holds ENIs in the subnets and blocks the network stack (02) from
deleting otherwise.

```bash
# 1. In-cluster + hand-created resources (ALB, workloads, Helm add-ons,
#    per-service security groups). kubectl must point at the cluster.
./scripts/cleanup-cluster.sh prod            # dry run (plan only)
./scripts/cleanup-cluster.sh prod --apply    # delete

# 2. CloudFormation stacks, reverse order 07 -> 01.
./scripts/teardown.sh prod                   # dry run (plan only)
./scripts/teardown.sh prod --apply           # delete
```

Both scripts are dry-run by default and require typing the environment name to
confirm on `prod`. `cleanup-cluster.sh` is best-effort (keeps going if a resource
is already gone). RDS has `DeletionProtection=false` with
`DeletionPolicy=Snapshot`, so the data stack deletes cleanly and leaves a final
snapshot. EKS control planes, NAT gateways, Multi-AZ RDS, and ElastiCache are NOT
free tier — tear down environments you are no longer using.

---

## Cost & safety notes

- **Not free tier:** the EKS control plane (hourly), NAT gateways (hourly + data),
  Multi-AZ RDS, and ElastiCache all bill continuously. Fargate bills per pod
  vCPU/memory-second while pods run — cheaper when idle than an always-on node
  group, but still real money at steady state.
- Every script defaults to **dry run / change-set only**. Nothing is created until
  you pass `--apply`, mirroring the safety pattern in `../scripts/push-to-ecr.sh`.
- Secrets Manager **generates** every database master password. No plaintext
  password ever appears in a template, a parameter file, or git history.
- SNS / SQS / Valkey are **on**. Event routing (mirrors
  `../localstack/init/01-messaging.sh`). Publishers send to the `ridenow-<env>-events`
  topic. Each queue has one raw-delivery subscription, so the SQS body is the event JSON
  itself, and the filter policy matches the body's top-level `type`:

  | Queue | Subscription filter (`type`) | Consumer |
  |-------|--------------------------------|----------|
  | `ridenow-<env>-matching` | `trip.requested` | matching-service |
  | `ridenow-<env>-payment` | `trip.completed`, `trip.cancelled` | payment-service |
  | `ridenow-<env>-notifications` | none (every event) | notification-worker |

  Each has a `-dlq` (maxReceiveCount 5). Valkey serves driver live state, the GEO
  index, the driver location Pub/Sub channel, the `ridenow:stream:driver-locations`
  stream that matching-service reads through a consumer group (deploy driver-service
  first, then matching-service), and the trip tracking pairing keys that
  notification-worker writes and realtime-gateway (the SSE service at `/live` on the
  ALB) reads.
- **Valkey engine:** stack 05 uses `Engine: valkey` (version 8.0, parameter group
  `default.valkey8`), about 20% cheaper than Redis OSS with the same clients. The
  `Redis*` logical IDs, the `EnableRedis` / `RedisNodeType` parameters and the
  `RedisPrimaryEndpoint` export keep their names, because renaming would replace the
  cluster. An existing Redis OSS group is migrated in place when the stack is updated;
  its data is ephemeral and rebuilt by the apps.
- **Upgrading an existing stack 01:** the shared `ridenow-<env>-app-access`
  policy no longer grants SQS / SNS. Anything that relied on it for
  messaging (for example a hand-made notification-worker role from guide 08)
  must move to the per-service role from stack 07 *before* stack 01 is updated,
  or it loses queue access.
- **Valkey TLS:** ElastiCache has in-transit encryption on, so clients must
  connect with TLS. Every Redis-protocol client (driver-service, matching-service,
  notification-worker, realtime-gateway) reads `REDIS_SSL` (default `false` locally)
  and the Kubernetes manifests set it to `true`.

---

## Layout

```
iac/
  stacks/
    01-iam.yaml            # cluster role + Fargate pod execution role
    02-network.yaml        # 2-AZ VPC, NAT per AZ, cluster SG, DB SG
    03-ecr.yaml
    04-data.yaml
    05-messaging.yaml      # SNS/SQS/Valkey
    06-eks-cluster.yaml    # control plane + Fargate profiles (no node group)
    07-eks-addons.yaml     # gated: ALB controller / external-secrets IRSA
  params/
    dev.json  staging.json  prod.json   # same prod shape; differ by name + CIDR
  k8s/
    <per-service Deployment/Service/Ingress/HPA manifests>
  scripts/
    check-consistency.sh   # static checks: stacks, manifests, params and guides agree (no AWS calls)
    deploy.sh              # 01 -> 07, dry-run by default; --parallel runs independent stacks together (auto-resolves OIDC for 07)
    deploy-and-test.sh     # whole runbook in one command: stacks, in-cluster setup, services, Ingress, API test
    alb-controller-policy.sh # attaches the versioned ALB controller IAM policy to stack 07's role (after the Helm install)
    cleanup-cluster.sh     # in-cluster + hand-created resources; run before teardown
    teardown.sh            # 07 -> 01, dry-run by default
  README.md
```
