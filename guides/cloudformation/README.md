# RideNow on AWS - CloudFormation, one command at a time

Deploy the RideNow backend (EKS Fargate, six RDS databases, SNS/SQS, Valkey, ALB) by
running the CloudFormation stacks in `iac/stacks/` yourself, one AWS service per file.
Every file has the same four parts:

1. **What it creates** - the resources and why.
2. **Configure** - the parameters, shown and changed from the command line.
3. **Deploy** - the exact command.
4. **Verify** - commands whose output tells you pass or fail. You never need the console.

This is the CLI counterpart to `../aws/` (console clicks) and a step-by-step version of
`../../iac/scripts/deploy.sh` (all stacks in one go). The templates are the same ones.

> Cost: the EKS control plane, NAT gateways, Multi-AZ RDS and ElastiCache bill by the hour
> from the moment they are created. Tear down with `99-teardown.md` when you finish.

## Before you start

Read `00-prerequisites.md`, then in every new terminal, from the repo root:

```bash
source guides/cloudformation/env.sh
```

This sets `ENV` (default `prod`), the region (default `ap-southeast-1`), and these helpers
used in every guide:

| Helper | What it does |
|--------|--------------|
| `cfn_deploy <layer> [Key=Value]` | Deploys `iac/stacks/<layer>.yaml` with `iac/params/$ENV.json`; extra `Key=Value` overrides one parameter for that run |
| `stack_status <layer>` | Prints the stack status (`CREATE_COMPLETE`, ...) |
| `stack_failures <layer>` | Prints which resource failed and why |
| `stack_outputs <layer>` | Prints the stack outputs |
| `exp <Name>` | Prints the value of export `ridenow-$ENV-<Name>` |
| `k8s_apply <manifest>` | Fills the placeholders of `iac/k8s/<manifest>.yaml` and applies it |

## The order

Do the files top to bottom. Each one needs the ones before it.

### Infrastructure (CloudFormation)

| File | AWS service | Stack | Typical time |
|------|-------------|-------|--------------|
| `01-iam.md` | IAM | `ridenow-<env>-01-iam` | 1 min |
| `02-vpc.md` | VPC, NAT, security groups | `02-network` | 4 min |
| `03-ecr.md` | ECR | `03-ecr` | 1 min |
| `04-rds.md` | RDS PostgreSQL (6), Secrets Manager, KMS | `04-data` | 10-20 min |
| `05-sns-sqs-valkey.md` | SNS, SQS (+ DLQs), ElastiCache Valkey | `05-messaging` | 10-15 min |
| `06-eks-cluster.md` | EKS control plane, Fargate profiles | `06-eks-cluster` | 10-15 min |
| `07-eks-irsa.md` | IAM roles for service accounts, DB/Redis access rules | `07-eks-addons` | 1 min |

Stacks 04, 05 and 06 do not depend on each other. Start them in three terminals to save
about 30 minutes (each file says how to check on a stack that is still creating).

### Images and cluster setup (CLI, no CloudFormation)

| File | What |
|------|------|
| `08-images.md` | Build the seven images and push them to ECR |
| `09-coredns.md` | Make CoreDNS run on Fargate |
| `10-alb-controller.md` | AWS Load Balancer Controller (Helm) |
| `11-external-secrets.md` | External Secrets Operator (Helm) and the KMS grant |
| `12-namespace-and-pod-networking.md` | Namespace, per-pod security groups, log router, database secrets |

### Services (one file per service)

`services/README.md` gives the order. Files: `payment-service.md`, `user-service.md`,
`driver-service.md`, `trip-service.md`, `matching-service.md`, `notification-worker.md`,
`realtime-gateway.md`.

### Expose, test, remove

| File | What |
|------|------|
| `20-ingress-alb.md` | The internet-facing ALB |
| `21-smoke-test.md` | End-to-end checks through the ALB |
| `99-teardown.md` | Delete everything in the right order |

## Check everything at once

```bash
for L in 01-iam 02-network 03-ecr 04-data 05-messaging 06-eks-cluster 07-eks-addons; do
  printf '%-16s %s\n' "$L" "$(stack_status $L)"
done
```

Every line should end in `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

## If a stack fails

```bash
stack_failures 04-data              # which resource, and the reason
```

A first create that fails ends in `ROLLBACK_COMPLETE`. That stack can only be deleted:

```bash
aws cloudformation delete-stack --stack-name ridenow-$ENV-04-data
aws cloudformation wait stack-delete-complete --stack-name ridenow-$ENV-04-data
```

Fix the cause, then run the same `cfn_deploy` again. Re-running a deploy on a healthy stack
is safe and changes nothing when there is nothing to change.