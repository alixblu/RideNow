# RideNow on AWS - Hybrid: CloudFormation foundation + manual EKS

Same destination as `../aws/` (the RideNow backend running on Amazon EKS), but
split by **how** you provision:

- **Steps 1-4 (the foundation): CloudFormation.** IAM, VPC/network, ECR, and
  RDS+Secrets are deployed from the templates already in `../../iac/stacks/`.
  One command brings them up; one brings them down. No clicking.
- **Steps 5+ (the interesting part): manual console.** EKS cluster, deploying
  the workloads, and the later ops (ElastiCache, SQS/EventBridge) you do by hand
  in the console - so you learn those surfaces click-by-click.

> This folder adds **nothing new to deploy** - it reuses the committed
> CloudFormation in `../../iac/` for the foundation and the manual console steps
> from `../aws/` for the rest. It's a different *route*, not different infra.

---

## Why this split

The foundation (networking, registries, databases) is repetitive, easy to get
subtly wrong by hand, and boring to click 20+ times - exactly what IaC is for.
The cluster and workloads are where the learning is, so you do those manually.

CloudFormation also gives you **named exports** that the manual steps read (VPC
id, subnet ids, DB endpoints, secret ARNs), so wiring EKS to the foundation is
copy-the-value, not guesswork.

---

## Order

| # | Step | How | Guide |
|---|------|-----|-------|
| 1-4 | IAM + VPC + ECR + RDS/Secrets | **CloudFormation** (`iac/stacks/01..04`) | `01-04-cloudformation-foundation.md` |
| 5 | Push images to ECR | script/CLI | `05-push-images.md` |
| 6 | EKS cluster + node group + kubectl | **manual console** | `06-eks-cluster.md` |
| 7 | Deploy workloads + ALB Ingress | **manual** (kubectl + console) | `07-eks-deploy.md` |
| 8 | ElastiCache for Redis (later op) | **manual console** | `08-later-elasticache-redis.md` |
| 9 | SQS + EventBridge (later op) | **manual console** | `09-later-sqs-eventbridge.md` |

Steps 6-9 are intentionally the **same manual content** as `../aws/05-08`; this
folder's job is only to swap the 1-4 foundation over to CloudFormation and point
the manual steps at the stack **exports** instead of console-created resources.

---

## One thing the committed templates DON'T cover

`iac/stacks/03-ecr.yaml` and `04-data.yaml` were written for the **four original
HTTP services** (user, driver, trip, payment). They do **not** create the ECR
repos or RDS instances for the two newer services:

- `matching-service`
- `notification-worker`

Per your instruction, these guides **do not modify** the templates. So after the
CloudFormation foundation is up, you create those two extra pieces **by hand**
(the guides tell you exactly where). If you'd rather extend the templates later,
that's a separate change.

---

## Cost warning

Same as `../aws/`: NAT gateway, RDS, EKS control plane, NAT, and (later)
ElastiCache all bill hourly. CloudFormation makes teardown easy - `teardown.sh`
removes 1-4 in one shot. Delete the manual pieces (EKS, ALB, ElastiCache) first,
since the cluster/LB can hold the network stack open.

## Prerequisites

- AWS CLI v2 configured (`aws sts get-caller-identity` works) as a non-root user.
- `jq` installed (the deploy script builds parameters with it).
- Docker (to push images), `kubectl`, and `helm` (for the ALB controller).
- Pick ONE region; the templates default to `ap-southeast-1`.

Start with `01-04-cloudformation-foundation.md`.
