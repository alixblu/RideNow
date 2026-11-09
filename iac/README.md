# RideNow - Infrastructure as Code (CloudFormation + EKS)

Production-grade, **layered** CloudFormation for the RideNow backend. This is the
"codify it" counterpart to the console-first AWS guides in `../docs/guides/`
(Stages 7-13). The console guides teach each AWS resource by hand; this folder
reproduces the same footprint as reviewable, repeatable templates.

> These templates provision a **production** footprint: a multi-AZ VPC, per-service
> Multi-AZ RDS, SQS/EventBridge/Redis, and an EKS cluster whose pods run on **AWS
> Fargate** (serverless — no EC2 node groups to size, patch, or autoscale). Pods
> are scheduled by namespace-matched Fargate profiles and billed per vCPU/memory
> second while they run.

---

## What this provisions

| Layer | Template | Creates | Hardening |
|-------|----------|---------|-----------|
| 1 | `stacks/01-iam.yaml` | EKS cluster role, Fargate pod execution role, scoped ECR / Secrets / messaging policy for IRSA | Least privilege; ARNs scoped to `ridenow/*` and `ridenow-<env>-*` |
| 2 | `stacks/02-network.yaml` | VPC, public + private subnets (3 AZs), IGW, one NAT per AZ, route tables, cluster SG, DB SG | Private subnets for workloads + data; DB SG allows 5432 only from the cluster SG |
| 3 | `stacks/03-ecr.yaml` | One repo per service: `ridenow/{user,driver,trip,payment}-service` | Scan-on-push, KMS encryption, lifecycle expiry |
| 4 | `stacks/04-data.yaml` | One RDS PostgreSQL **per service** (database-per-service rule) | Multi-AZ, `StorageEncrypted` + KMS, private, credentials in Secrets Manager (generated, never in templates) |
| 5 | `stacks/05-messaging.yaml` | SQS + DLQ, EventBridge bus, ElastiCache Redis | Encrypted, private; consumed by matching-service / notification-worker |
| 6 | `stacks/06-eks-cluster.yaml` | EKS control plane + **Fargate profiles** (app, system, observability) — no EC2 node group | KMS secrets envelope-encryption, OIDC/IRSA, serverless pods on private subnets |
| 7 | `stacks/07-eks-addons.yaml` | IRSA roles for AWS Load Balancer Controller + External Secrets | Gated; scoped trust to the cluster OIDC provider |

Kubernetes workload manifests (Deployment / Service / Ingress / HPA) live in `k8s/`.

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
files). The **same templates** deploy every environment and every environment is
provisioned to the **same production shape**; only the `Environment` name and the
VPC CIDR differ so multiple environments can coexist in one account/region.

| Knob | value (all environments) |
|------|--------------------------|
| AZ count / NAT gateways | 3 AZ, one NAT per AZ |
| RDS Multi-AZ | true |
| RDS instance class | `db.r6g.large` |
| RDS deletion protection | false (snapshot on delete) |
| RDS backup retention (days) | 30 |
| EKS compute | **Fargate** (serverless pods; no node group, no autoscaler) |
| Messaging (SQS/EventBridge) | on |
| Redis (ElastiCache) | on |

This matches the recorded RideNow config decision: **one image promoted unchanged
across environments; the environment supplies the differences** (laptop defaults ->
Compose `.env` -> ConfigMap/Secret/Secrets Manager). No `dev`/`prod` baked into any
service image.

---

## Prerequisites

- AWS CLI v2 configured (`aws sts get-caller-identity` succeeds) as a non-root user
  (LEARNING_PATH Stage 7).
- Permission to create IAM roles, VPCs, RDS, EKS (incl. Fargate profiles), ECR,
  SQS/EventBridge, and ElastiCache.
- For template authoring/validation only: `cfn-lint` (`pip install cfn-lint`).
- For the Kubernetes layer: `kubectl` and (when a cluster exists) `aws eks
  update-kubeconfig`.

## Deploy

```bash
# Dry run (default, SAFE): emits a change set per layer, applies NOTHING.
./scripts/deploy.sh prod

# Apply for real (creates billable resources):
./scripts/deploy.sh prod --apply
```

`deploy.sh` walks stacks 01 -> 07 in order, feeding `params/<env>.json`, and waits
for each to reach a stable state before starting the next (because later layers
import earlier exports). Stack **07-eks-addons** needs the cluster's OIDC provider
id, which only exists after stack 06 — the script **resolves it automatically**
(`aws eks describe-cluster`) and injects it, so the whole infra half is one
command. (During a dry run before 06 exists the id can't be resolved; the script
warns and leaves it blank, which is harmless for the change-set preview.)

> This provisions **infrastructure only**. The image build, the in-cluster Helm /
> `kubectl` add-ons, and the service manifests are separate steps. Follow
> `../localfile/aws/00-deploy-runbook.md` for the full dependency-ordered sequence
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
- SQS / EventBridge / Redis are **on**: matching-service consumes Redis and the
  notification-worker consumes SQS.

---

## Layout

```
iac/
  stacks/
    01-iam.yaml            # cluster role + Fargate pod execution role
    02-network.yaml        # 3-AZ VPC, NAT per AZ, cluster SG, DB SG
    03-ecr.yaml
    04-data.yaml
    05-messaging.yaml      # SQS/EventBridge/Redis
    06-eks-cluster.yaml    # control plane + Fargate profiles (no node group)
    07-eks-addons.yaml     # gated: ALB controller / external-secrets IRSA
  params/
    dev.json  staging.json  prod.json   # same prod shape; differ by name + CIDR
  k8s/
    <per-service Deployment/Service/Ingress/HPA manifests>
  scripts/
    deploy.sh              # 01 -> 07, dry-run by default (auto-resolves OIDC for 07)
    cleanup-cluster.sh     # in-cluster + hand-created resources; run before teardown
    teardown.sh            # 07 -> 01, dry-run by default
  README.md
```
