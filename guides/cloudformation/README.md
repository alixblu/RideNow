# RideNow on AWS - build it by hand in the console

Deploy RideNow (EKS Fargate, six RDS databases, SNS/SQS, Valkey, ALB, and the S3/CloudFront frontend)
by creating each AWS resource yourself in its own service console. There is one guide per
group of resources. The settings come from the read-only templates in `iac/stacks/` and from
`iac/params/prod.json`. Nothing is deployed from the templates.

## How the guides work

**Service console workflow.** Each guide from `01-iam.md` to `08-frontend.md` has the same sections,
in this order:

1. **What it creates** - a table of the resources and their names.
2. **Depends on** - the earlier resources it uses, by name, and the guide that creates each one.
3. **Create the resources** - console fields and the exact value to enter, step by step.
4. **Values to record** - the values later guides need, and which guide uses each.
5. **Post-Deploy** - the non-console steps for that guide, or a note that none are needed.
6. **Verify** - bash checks that print a value, with the expected result.

**CLI-only exceptions.** The AWS CLI, `kubectl` and Helm are used only for:

- EKS kubeconfig setup
- applying Kubernetes manifests
- installing EKS add-ons and Helm charts
- creating Kubernetes secrets
- building and pushing images
- connection checks
- settings the console cannot set (the guide states the reason in that step)

Every other step is console navigation. All command blocks are Bash and run in WSL, and each
one states its expected result.

**Shell variables.** Guides that need shell variables use the
[Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws)
in `00-deploy-runbook.md`. Run it once in each new terminal, from the repo root. It reads
the values from the resources you created and from `iac/params/prod.json`. It changes nothing
in AWS.

> Cost: the EKS control plane, NAT gateways, Multi-AZ RDS and ElastiCache bill by the hour
> from the moment they are created.

## The order

Start with `00-deploy-runbook.md`, then follow the guides in numeric order up to
`08-frontend.md`.

| Guide | AWS services it creates | Non-console steps included |
|-------|-------------------------|----------------------------|
| `00-deploy-runbook.md` | none (checklist, Discovery_Block, redeploy and teardown) | Tool and identity checks, image build, CoreDNS, add-on installs, service deploy |
| `01-iam.md` | IAM roles and policies | none |
| `02-network.md` | VPC, subnets, NAT gateways, route tables, security groups | none |
| `03-ecr.md` | ECR repositories | Build the seven service images and push them to ECR |
| `04-data.md` | KMS, DB subnet group, RDS PostgreSQL (6), Secrets Manager | none |
| `05-messaging.md` | SNS, SQS (with DLQs), ElastiCache Valkey | none |
| `06-eks-cluster.md` | EKS control plane, Fargate profiles | kubeconfig, CoreDNS on Fargate, AWS Load Balancer Controller, External Secrets Operator, namespace, pod networking, database secrets, ALB ingress, smoke test |
| `07-eks-addons.md` | Pod network access rules, IAM OIDC provider, IRSA roles | IRSA role checks and the seven service deploys: payment-service, user-service, driver-service, trip-service, matching-service, notification-worker, realtime-gateway |
| `08-frontend.md` | S3, CloudFront, IAM (GitHub OIDC deploy role) | GitHub Environment and variables, first publish of the site, rollback |

### Independence of 04, 05 and 06

`04-data.md`, `05-messaging.md` and `06-eks-cluster.md` do not depend on each other. Each one
uses only resources from `01-iam.md` and `02-network.md`. After those two are done you can
create the three groups in any order.

### Ordering constraint: 07-eks-addons

Create the `07-eks-addons.md` resources after the `06-eks-cluster.md` resources and before
the AWS Load Balancer Controller and External Secrets installations. Their IRSA roles are
the roles those two installations run as. So:

1. Create the cluster resources in `06-eks-cluster.md`.
2. Create the resources in `07-eks-addons.md` (up to its Verify of the IRSA roles).
3. Return to the Post-Deploy steps of `06-eks-cluster.md` and install the AWS Load Balancer
   Controller and External Secrets.
4. Deploy the seven services from `07-eks-addons.md`.

The smoke test in `06-eks-cluster.md` returns `200` only after the services are running.

### Ordering constraint: 08-frontend

Create the `08-frontend.md` resources last, after the services are deployed and the `ridenow`
Ingress has an ALB address. CloudFront uses that ALB as its API origin. To check that the
address exists, run the Discovery_Block and then:

```bash
echo "$ALB_DNS_NAME"
```

Expected: a hostname ending in `.elb.amazonaws.com`. If it is empty, the Ingress has no
address yet; see Phase 6.2 in `00-deploy-runbook.md`.

## Check everything at once

After you finish all guides, run the Discovery_Block, then:

```bash
for V in VPC_ID CLUSTER_NAME REDIS_ENDPOINT ALB_DNS_NAME CLOUDFRONT_DOMAIN; do
  printf '%-18s %s\n' "$V" "${!V:-MISSING}"
done
```

Expected: no line shows `MISSING`. Each guide also has its own Verify section.

## If a creation step fails

Open the console page of the resource that failed. It shows the error message. Fix the cause
and repeat the step with the values in the guide.
