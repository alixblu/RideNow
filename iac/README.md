# RideNow - Infrastructure as Code (CloudFormation + EKS)

Production-grade, **layered** CloudFormation for the RideNow backend. This is the
"codify it" counterpart to the console-first AWS guides in `../docs/guides/`
(Stages 7-13). The console guides teach each AWS resource by hand; this folder
reproduces the same footprint as reviewable, repeatable templates.

> This directory is **new ground**. The architecture docs defer AWS, EKS, Redis,
> SQS, and EventBridge until a feature needs them. These templates provision that
> footprint for the four services that are actually built today; capabilities with
> no consumer yet (Redis / SQS / EventBridge) are **parameter-gated and default
> OFF**, so nothing paid is created ahead of the feature that uses it.

---

## What this provisions

| Layer | Template | Creates | Hardening |
|-------|----------|---------|-----------|
| 1 | `stacks/01-iam.yaml` | EKS cluster role, node role, IRSA OIDC-consumer roles, scoped ECR / Secrets / messaging policies | Least privilege; ARNs scoped to `ridenow/*` and `ridenow-<env>-*` |
| 2 | `stacks/02-network.yaml` | VPC, public + private subnets (multi-AZ), IGW, NAT, route tables, app/node SG, DB SG | Private subnets for workloads + data; DB SG allows 5432 only from the node SG |
| 3 | `stacks/03-ecr.yaml` | One repo per service: `ridenow/{user,driver,trip,payment}-service` | Scan-on-push, KMS encryption, lifecycle expiry |
| 4 | `stacks/04-data.yaml` | One RDS PostgreSQL **per service** (database-per-service rule) | Multi-AZ, `StorageEncrypted` + KMS, private, credentials in Secrets Manager (generated, never in templates) |
| 5 | `stacks/05-messaging.yaml` | SQS + DLQ, EventBridge bus, ElastiCache Redis | **Gated OFF by default**; encrypted, private; provisioned ahead of matching-service / notification-worker |
| 6 | `stacks/06-eks-cluster.yaml` | EKS control plane + managed node group (private) | KMS secrets envelope-encryption, OIDC/IRSA, private nodes with NAT egress |
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
ridenow-prod-network-NodeSecurityGroupId
ridenow-prod-network-DbSecurityGroupId
ridenow-prod-iam-ClusterRoleArn
ridenow-prod-iam-NodeRoleArn
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
                    ├─> 06-eks-cluster (cluster + node roles)
02-network ─────────┼─> 04-data        (private subnets, DB SG, KMS)
                    ├─> 05-messaging    (private subnets, SG)   [gated]
                    └─> 06-eks-cluster (private subnets, node SG)
03-ecr ─────────────────> k8s/ manifests (image URIs)
04-data (secret ARNs) ──> k8s/ manifests (DB env wiring via External Secrets)
06-eks-cluster ─────────> 07-eks-addons (OIDC provider ARN)     [gated]
```

---

## Environments

Per-environment values live in `params/<env>.json` (CloudFormation parameter
files). The **same templates** deploy every environment; only the parameter file
changes. Production turns on the expensive, durable options:

| Knob | dev | staging | prod |
|------|-----|---------|------|
| AZ count / NAT gateways | 2 AZ, 1 NAT | 2 AZ, 2 NAT | 3 AZ, 3 NAT |
| RDS Multi-AZ | false | true | true |
| RDS instance class | `db.t4g.micro` | `db.t4g.small` | `db.r6g.large` |
| RDS deletion protection | false | true | true |
| RDS backup retention (days) | 1 | 7 | 30 |
| EKS node count (min/desired/max) | 1/2/3 | 2/3/6 | 3/4/12 |
| EKS node instance type | `t3.medium` | `t3.large` | `m6i.large` |
| Messaging (SQS/EventBridge) | off | on | on |
| Redis (ElastiCache) | off | on | on |

This matches the recorded RideNow config decision: **one image promoted unchanged
across environments; the environment supplies the differences** (laptop defaults ->
Compose `.env` -> ConfigMap/Secret/Secrets Manager). No `dev`/`prod` baked into any
service image.

---

## Prerequisites

- AWS CLI v2 configured (`aws sts get-caller-identity` succeeds) as a non-root user
  (LEARNING_PATH Stage 7).
- Permission to create IAM roles, VPCs, RDS, EKS, ECR, and (gated) SQS/EventBridge/
  ElastiCache.
- For template authoring/validation only: `cfn-lint` (`pip install cfn-lint`).
- For the Kubernetes layer: `kubectl` and (when a cluster exists) `aws eks
  update-kubeconfig`.

## Deploy

```bash
# Dry run (default, SAFE): emits a change set per layer, applies NOTHING.
./scripts/deploy.sh dev

# Apply for real (creates billable resources):
./scripts/deploy.sh dev --apply
```

`deploy.sh` walks stacks 01 -> 07 in order, feeding `params/<env>.json`, and waits
for each to reach a stable state before starting the next (because later layers
import earlier exports).

## Teardown

```bash
./scripts/teardown.sh dev            # prints reverse-order plan, deletes nothing
./scripts/teardown.sh dev --apply    # deletes 07 -> 01 in order
```

`prod` has deletion protection on RDS and refuses to tear down without an explicit
extra confirmation. **Always tear down dev/staging when you stop working** - EKS
control planes, NAT gateways, and Multi-AZ RDS are NOT free tier.

---

## Cost & safety notes

- **Not free tier:** EKS control plane (hourly), NAT gateways (hourly + data), and
  Multi-AZ RDS all bill continuously. A full `prod` stack left running overnight is
  real money.
- Every script defaults to **dry run / change-set only**. Nothing is created until
  you pass `--apply`, mirroring the safety pattern in `../scripts/push-to-ecr.sh`.
- Secrets Manager **generates** every database master password. No plaintext
  password ever appears in a template, a parameter file, or git history.
- Redis / SQS / EventBridge are **off in dev** on purpose: no RideNow service
  consumes them yet (matching-service and notification-worker are not built). Turn
  them on only when the consuming feature lands.

---

## Layout

```
iac/
  stacks/
    01-iam.yaml
    02-network.yaml
    03-ecr.yaml
    04-data.yaml
    05-messaging.yaml      # gated: SQS/EventBridge/Redis
    06-eks-cluster.yaml
    07-eks-addons.yaml     # gated: ALB controller / external-secrets IRSA
  params/
    dev.json  staging.json  prod.json
  k8s/
    <per-service Deployment/Service/Ingress/HPA manifests>
  scripts/
    deploy.sh              # 01 -> 07, dry-run by default
    teardown.sh            # 07 -> 01, dry-run by default
  README.md
```
