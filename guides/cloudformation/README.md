# RideNow on AWS - CloudFormation, one command at a time

Deploy the RideNow backend (EKS Fargate, six RDS databases, SNS/SQS, Valkey, ALB) by
running the CloudFormation stacks in `iac/stacks/` yourself. There is one guide per stack.
Steps that are not CloudFormation (image build, kubectl and Helm setup, IRSA checks, service
deploys) sit inside the guide of the stack they belong to.

Every stack guide has the same sections:

1. **What it creates** and **Configure** - the resources, and the parameters you can change.
2. **Deploy** - the exact `cfn_deploy` command, a status check and a failure check.
3. **Post-Deploy** - the non-CloudFormation steps for that stack, or a note that none are needed.
4. **Verify** - CLI commands whose output tells you pass or fail. You never need the console.
5. **Final check** - read-only commands to run once the whole deployment is finished.

This is the CLI counterpart to `../aws/` (console clicks) and a step-by-step version of
`../../iac/scripts/deploy.sh` (all stacks in one go). The templates are the same ones.
All commands are Bash and run in WSL. There is no master script: run each command yourself.

> Cost: the EKS control plane, NAT gateways, Multi-AZ RDS and ElastiCache bill by the hour
> from the moment they are created.

## Before you start

Read `00-prerequisites.md`, then in every new terminal, from the repo root:

```bash
source guides/cloudformation/env.sh
```

This sets `ENV` (default `prod`), the region (default `ap-southeast-1`), and these helpers
used in every guide:

| Helper | What it does |
|--------|--------------|
| `cfn_deploy <layer> [Key=Value]` | Deploys `iac/stacks/<layer>.yaml` as `ridenow-$ENV-<layer>` with `iac/params/$ENV.json`; extra `Key=Value` overrides one parameter for that run |
| `stack_status <layer>` | Prints the stack status (`CREATE_COMPLETE`, ...) |
| `stack_failures <layer>` | Prints which resource failed and why |
| `stack_outputs <layer>` | Prints the stack outputs as a table |
| `exp <Name>` | Prints the value of export `ridenow-$ENV-<Name>` |
| `params <layer>` | Prints the `Key=Value` lines of that layer from `iac/params/$ENV.json` |
| `k8s_apply <manifest>` | Fills the placeholders of `iac/k8s/<manifest>.yaml` and applies it |

## The order

Run the guides in numeric order, from `00-prerequisites.md` to `07-eks-addons.md`.

| Guide | Stack (`ridenow-<env>-...`) | AWS services | Non-CloudFormation steps included | Typical time |
|-------|-----------------------------|--------------|-----------------------------------|--------------|
| `00-prerequisites.md` | none | AWS CLI, kubectl, Helm, Docker, jq | Tool and identity checks | 5 min |
| `01-iam.md` | `01-iam` | IAM | none | 1 min |
| `02-network.md` | `02-network` | VPC, NAT, security groups | none | 4 min |
| `03-ecr.md` | `03-ecr` | ECR | Build the seven service images and push them to ECR | 1 min plus image builds |
| `04-data.md` | `04-data` | RDS PostgreSQL (6), Secrets Manager, KMS | none | 10-20 min |
| `05-messaging.md` | `05-messaging` | SNS, SQS (+ DLQs), ElastiCache Valkey | none | 10-15 min |
| `06-eks-cluster.md` | `06-eks-cluster` | EKS control plane, Fargate profiles | kubeconfig, CoreDNS on Fargate, AWS Load Balancer Controller, External Secrets Operator and KMS grant, namespace, pod networking, database secrets, ALB ingress, smoke test | 10-15 min plus setup |
| `07-eks-addons.md` | `07-eks-addons` | IAM roles for service accounts (IRSA), DB/Redis access rules | IRSA role checks and the seven service deploys: payment-service, user-service, driver-service, trip-service, matching-service, notification-worker, realtime-gateway | 1 min plus deploys |

### Independence of 04, 05 and 06

`04-data`, `05-messaging` and `06-eks-cluster` do not depend on each other. Each one imports
only from `01-iam` and `02-network`. After those two are done you can deploy the three in
any order, or in three terminals at once to save about 30 minutes. To check on a stack that
is still creating, run `stack_status <layer>` (it prints `CREATE_IN_PROGRESS` until done).

### Ordering caveat: 07-eks-addons before the ALB controller

The Post-Deploy steps of `06-eks-cluster.md` include the AWS Load Balancer Controller, and
its IAM role is created by the `07-eks-addons` stack. Deploy the `07-eks-addons` stack (the
Deploy section of `07-eks-addons.md`, up to `stack_status`) before you reach the "AWS Load
Balancer Controller" step in `06-eks-cluster.md`. The External Secrets step needs the same
stack. Then finish the Post-Deploy steps of `06-eks-cluster.md` and the service deploys in
`07-eks-addons.md`. The smoke test in `06-eks-cluster.md` returns `200` only after the
services are running.

## Check everything at once

```bash
for L in 01-iam 02-network 03-ecr 04-data 05-messaging 06-eks-cluster 07-eks-addons; do
  printf '%-16s %s\n' "$L" "$(stack_status $L)"
done
```

Every line should end in `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

Each guide also ends with a `Final check` section for its own stack. Run them after the
whole process is finished.

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
