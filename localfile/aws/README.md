# RideNow on AWS - Console-First, Step by Step (Backend)

A hands-on, **click-by-click** path to run the RideNow backend on AWS using the
**Management Console**. No CloudFormation, no CLI-only steps except where the
console genuinely can't do the thing (building/pushing a Docker image, and
`kubectl` once the cluster exists). This is the console counterpart to the
codified templates in `../../iac/`.

> Scope: **backend only**, as requested. The goal is to get the four HTTP
> services + the notification worker + matching running on **Amazon EKS**, which
> is the piece you do by hand here. The stateful managed services the code can
> use (ElastiCache / SQS / EventBridge) are covered as **later operations** you
> switch on by changing environment variables - no code changes.

---

## What you are building

```
                 Internet
                    |
            ALB (Ingress)           <- one load balancer, routes by path
                    |
   /api/users  /api/drivers  /api/trips  /api/payments
        |            |            |            |
   user-svc     driver-svc    trip-svc    payment-svc      (Deployments on EKS)
        |            |            |            |
     RDS user    RDS driver   RDS trip    RDS payment       (one DB per service)

   matching-svc (internal)        notification-worker (no HTTP, consumes SQS)
        |                                |
   ElastiCache Redis (GEO/live)     SQS queue + DLQ  <--  EventBridge bus
                                         ^                     ^
                                    "later ops": switch on when you want the
                                    async + Redis features in the cloud
```

The application code is already written against the **real AWS SDK v2** (SQS,
EventBridge) and **Spring Data Redis**, exercised locally against LocalStack and
a Redis container. So "move to AWS" means: provision the managed resource in the
console, then point the same container image at it by changing environment
variables. No rebuild.

---

## The order (do these top to bottom)

EKS needs a network, images, and databases to be useful, so the dependency order
is IAM -> VPC -> ECR -> RDS/Secrets -> EKS -> deploy. The async/Redis pieces have
no hard dependency on EKS and can be done whenever you want those features.

| # | Guide | What it creates | Needed for EKS? |
|---|-------|-----------------|-----------------|
| 01 | `01-iam.md` | An admin-ish IAM user/role for yourself; the EKS cluster & node roles | yes (prereq) |
| 02 | `02-vpc.md` | VPC, public + private subnets (multi-AZ), IGW, NAT, route tables, security groups | yes |
| 03 | `03-ecr.md` | One ECR repo per service; build & push images | yes |
| 04 | `04-rds-secrets.md` | One RDS PostgreSQL per service; credentials in Secrets Manager | yes (pods need a DB) |
| 05 | `05-eks-cluster.md` | The EKS cluster + a managed node group; connect `kubectl` | **the main event** |
| 06 | `06-eks-deploy.md` | Namespace, Secrets, Deployments/Services, the ALB Ingress; verify traffic | yes (this is "done") |
| 07 | `07-later-elasticache-redis.md` | ElastiCache for Redis (live state, GEO, cache, pub/sub) | no - later op |
| 08 | `08-later-sqs-eventbridge.md` | SQS queue + DLQ, EventBridge bus + rule; wire the worker | no - later op |

Guides 01-06 get you a running backend on EKS. Guides 07-08 are the "others
later" operations you called out - switch them on when you want the async and
Redis features live in the cloud.

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

`*` = only when you do the later ops (07-08). Without them, driver/trip/payment/
user run fine; matching needs Redis to answer GEO queries; the worker idles with
no queue.

> The k8s manifests in `../../iac/k8s/` currently cover user/driver/trip/payment.
> When you deploy matching-service and notification-worker, add manifests for
> them following the same shape (guide 06 shows the pattern and the extra env).

---

## Cost warning (read before you click Create)

EKS control plane, NAT gateways, and RDS (especially Multi-AZ) **bill by the
hour whether or not you use them**. ElastiCache bills continuously too. This is
NOT free tier. When you stop for the day, tear down in reverse order
(08 -> 01) or at least delete the EKS node group, NAT gateways, and RDS
instances. Each guide ends with a "Clean up" note.

## Prerequisites

- An AWS account and the ability to sign in to the Console.
- Docker running locally (to build and push images in guide 03).
- `kubectl` installed (guide 05 connects it to the cluster).
- Pick ONE region and use it for everything (the guides use `ap-southeast-1`;
  substitute your own consistently).
