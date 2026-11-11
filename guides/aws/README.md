# RideNow on AWS - Console-First, Step by Step (Backend, Production)

A hands-on, **click-by-click** path to run the RideNow backend in **production**
on AWS using the **Management Console**. No CloudFormation, no CLI-only steps
except where the console genuinely can't do the thing (building/pushing a Docker
image, and `kubectl` once the cluster exists). This is the console counterpart to
the codified templates in `../../iac/`.

> Scope: **backend only**. The goal is to get the four HTTP services + the
> notification worker + matching running on **Amazon EKS with AWS Fargate** —
> serverless pods, no EC2 node group to size, patch, or autoscale. The stateful
> managed services the code uses (ElastiCache / SQS / EventBridge) are provisioned
> as part of the production footprint and wired via environment variables — no
> code changes.

---

## What you are building

```
                 Internet
                    |
            ALB (Ingress)           <- one load balancer, routes by path
                    |                   (targets pod IPs: target-type: ip)
   /api/users  /api/drivers  /api/trips  /api/payments
        |            |            |            |
   user-svc     driver-svc    trip-svc    payment-svc      (Fargate pods on EKS)
        |            |            |            |
     RDS user    RDS driver   RDS trip    RDS payment       (one Multi-AZ DB per service)

   matching-svc (internal)        notification-worker (no HTTP, consumes SQS)
        |                                |
   ElastiCache Redis (GEO/live)     SQS queue + DLQ  <--  EventBridge bus
```

Every pod runs on **Fargate**: EKS schedules it onto a right-sized micro-VM based
on the pod's CPU/memory requests — there are no nodes in the cluster. The
application code is written against the **real AWS SDK v2** (SQS, EventBridge) and
**Spring Data Redis**, so moving to AWS means provisioning the managed resource in
the console and pointing the same container image at it via environment variables.
No rebuild.

---

## The order (do these top to bottom)

EKS needs a network, images, and databases to be useful, so the dependency order
is IAM -> VPC -> ECR -> RDS/Secrets -> EKS -> deploy. Redis and the async
messaging layer are part of the production footprint and can be provisioned in
parallel once the network exists.

> **Deploying from the CloudFormation templates?** Read `00-deploy-runbook.md`
> first — it sequences the `iac/` stack deploys with the per-guide image-build,
> Helm, and `kubectl` steps in one dependency-correct order, and explains where
> each guide below slots in.

| # | Guide | What it creates | Needed for EKS? |
|---|-------|-----------------|-----------------|
| 01 | `01-iam.md` | An admin IAM user/role for yourself; the EKS cluster role and the Fargate pod execution role | yes (prereq) |
| 02 | `02-vpc.md` | VPC, public + private subnets (3 AZs), IGW, one NAT per AZ, route tables, security groups | yes |
| 03 | `03-ecr.md` | One ECR repo per service; build & push images | yes |
| 04 | `04-rds-secrets.md` | One Multi-AZ RDS PostgreSQL per service; credentials in Secrets Manager | yes (pods need a DB) |
| 05 | `05-eks-cluster.md` | The EKS cluster + Fargate profiles; connect `kubectl` | **the main event** |
| 06 | `06-eks-deploy.md` | Namespace, Secrets, Deployments/Services, the ALB Ingress; verify traffic | yes (this is "done") |
| 07 | `07-later-elasticache-redis.md` | ElastiCache for Redis (live state, GEO, cache, pub/sub) | matching-service |
| 08 | `08-later-sqs-eventbridge.md` | SQS queue + DLQ, EventBridge bus + rule; wire the worker | notification-worker |

Guides 01-06 get you a running backend on EKS Fargate. Guides 07-08 provision the
Redis and async messaging the matching-service and notification-worker depend on.

---

## The services (ports, image names, health)

These are the facts the console steps reference. They come straight from the
built code (`application.yaml` per service) and the k8s manifests in `../../iac/k8s/`.

| Service | Port | ECR repo | Health | Needs |
|---------|------|----------|--------|-------|
| user-service | 8081 | `ridenow/user-service` | `/actuator/health` | its RDS |
| driver-service | 8080 | `ridenow/driver-service` | `/actuator/health` | its RDS, user-service, Redis* |
| trip-service | 8082 | `ridenow/trip-service` | `/actuator/health` | its RDS, EventBridge* |
| payment-service | 8083 | `ridenow/payment-service` | `/actuator/health` | its RDS, EventBridge* |
| matching-service | 8085 | `ridenow/matching-service` | `/actuator/health` | its RDS, Redis* |
| notification-worker | 8084 (health only) | `ridenow/notification-worker` | `/actuator/health` | its RDS, SQS* |

`*` = provisioned in guides 07-08. driver/trip/payment/user run on their RDS;
matching needs Redis to answer GEO queries; the worker consumes the SQS queue.

> The k8s manifests in `../../iac/k8s/` cover user/driver/trip/payment plus
> matching-service and notification-worker. All are selected by the `ridenow`
> Fargate profile (namespace match), so they schedule onto Fargate with no node
> group present.

---

## Cost warning (read before you click Create)

The EKS control plane, NAT gateways (one per AZ), Multi-AZ RDS, and ElastiCache
**bill by the hour whether or not you use them**. This is NOT free tier. Fargate
is different: it bills **per pod vCPU/memory-second** while pods run, so idle
pods still cost (there's always at least `minReplicas` running) but there are no
always-on worker nodes. When you decommission an environment, tear down in
reverse order (08 -> 01). Each guide ends with a "Clean up" note.

## Prerequisites

- An AWS account and the ability to sign in to the Console.
- Docker running locally (to build and push images in guide 03).
- `kubectl` installed (guide 05 connects it to the cluster).
- Pick ONE region and use it for everything (the guides use `ap-southeast-1`;
  substitute your own consistently).
