# 00 - Deploy runbook: RideNow production on EKS Fargate, in order

This is the top-level checklist that stitches the CloudFormation stacks (`iac/`)
and the in-cluster steps (guides 05-08) into one dependency-correct sequence. It
exists because the IaC provisions **infrastructure**, not the **running
application** — a handful of image-build, Helm, and `kubectl` steps sit between
"stacks deployed" and "`GET /api/drivers` works".

Everything is `prod`. Region is `ap-southeast-1` throughout (substitute your own
consistently). Run `iac/` commands from the repo root.

> **Why an explicit order?** Later stacks import earlier stacks' exports, and the
> in-cluster add-ons depend on IAM roles that only exist after the cluster. Two
> ordering traps this runbook avoids: stack **07 must run after 06** (it needs the
> cluster's OIDC id), and the ALB-controller / External-Secrets Helm installs must
> run **after 07** (they use the IRSA roles 07 creates).

---

## Phase 0 - Prerequisites (once)

- AWS CLI v2 configured as a non-root admin: `aws sts get-caller-identity` works.
  (Guide `01-iam.md` creates that user and the two EKS roles by console; the
  CloudFormation path below creates the roles instead — do one or the other, not
  both. This runbook uses CloudFormation.)
- `docker`, `kubectl`, `helm`, and `jq` installed.
- Pick the region and keep it consistent.

---

## Phase 1 - Infrastructure (CloudFormation, stacks 01 -> 07)

`deploy.sh` walks the stacks in order, feeds `params/prod.json`, and now
**auto-resolves the cluster OIDC id** between stack 06 and stack 07 — so the whole
infra half is one command.

```bash
# 1. Dry run (SAFE): emits a change set per stack, creates nothing.
./iac/scripts/deploy.sh prod

# 2. Apply for real (creates billable resources):
./iac/scripts/deploy.sh prod --apply
```

What this provisions, in order:

| Stack | Creates | Notes |
|-------|---------|-------|
| 01-iam | Cluster role + Fargate pod execution role + app-access policy | — |
| 02-network | 3-AZ VPC, NAT per AZ, cluster SG, DB SG | — |
| 03-ecr | One repo per service | **images come in Phase 2** |
| 04-data | 4 Multi-AZ RDS + Secrets Manager secrets | pods need these to be healthy |
| 05-messaging | SQS + DLQ, EventBridge bus, ElastiCache Redis | consumed by matching / worker |
| 06-eks-cluster | EKS control plane + 3 Fargate profiles | **no node group** |
| 07-eks-addons | ALB-controller + External-Secrets IRSA roles | OIDC id injected automatically |

> **Dry-run note:** during a dry run before 06 exists, the script can't resolve the
> OIDC id for stack 07 and prints a WARN (it leaves the value blank). That's
> expected — on the real `--apply` run, 06 is created first and the id resolves.

When this finishes you have the full AWS footprint but an **empty cluster** (only
the control plane + Fargate profiles). Point `kubectl` at it:

```bash
aws eks update-kubeconfig --name ridenow-prod --region ap-southeast-1
kubectl get svc kubernetes    # confirms you're connected
```

---

## Phase 2 - Build and push images (guide 03)

ECR repos exist (stack 03) but are empty. Build and push before deploying any
service manifest, or pods will `ImagePullBackOff`.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
REGION=ap-southeast-1
IMAGE_TAG=v1.0.0

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker; do
  docker buildx build --platform linux/amd64 \
    -t ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/ridenow/$SVC:$IMAGE_TAG \
    --push $SVC/
done
```

Verify each repo has the `v1.0.0` tag (guide 03 shows the `describe-images` check).

---

## Phase 3 - Make the cluster usable (guide 05 Part B)

Fargate has no nodes, and CoreDNS ships pinned to EC2 — patch it so it schedules
on the `kube-system` Fargate profile, or in-cluster DNS never comes up.

```bash
kubectl patch deployment coredns -n kube-system --type=json \
  -p='[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'
kubectl rollout restart deployment coredns -n kube-system
kubectl rollout status  deployment coredns -n kube-system
```

Also enable the OIDC identity provider in IAM if the console didn't
(guide 05 Part D) — the IRSA roles from stack 07 trust it.

---

## Phase 4 - In-cluster add-ons (guide 06 steps 1-2)

These use the IRSA roles stack 07 created. Order matters.

1. **AWS Load Balancer Controller** (Helm) — guide 06 step 1a/1b. Provisions the
   ALB for the Ingress in Phase 6.
2. **External Secrets Operator** (Helm) — guide 06 step 2 B2.
3. **KMS grant** so ESO can decrypt the RDS-managed secrets — guide 06 step 2 B1.
   (Without it ESO fails with `Access to KMS is not allowed`.)

Each has exact commands in `06-eks-deploy.md`. The IRSA role ARNs come from:

```bash
aws cloudformation list-exports --region ap-southeast-1 \
  --query "Exports[?starts_with(Name,'ridenow-prod-eks-')].{Name:Name,Value:Value}" \
  --output table --no-cli-pager
```

---

## Phase 5 - Namespace, security groups, secrets (guide 06 steps 2-2.5)

1. **Namespace:** `kubectl apply -f iac/k8s/00-namespace.yaml`.
2. **Per-pod security groups + `SecurityGroupPolicy`** — guide 06 step 2.5. Apply
   these **before** the service pods start so each pod gets its service SG at
   schedule time (a pod started earlier keeps the default cluster SG until
   recreated).
3. **Fargate log-router ConfigMap** (`aws-observability` namespace) — guide 06a
   Part 1.2. Apply before service pods so their logs ship to CloudWatch.
4. **ExternalSecret manifests:** substitute the RDS secret ARNs and region into
   `iac/k8s/10-external-secrets.yaml` and apply — guide 06 step 2 B3. Confirm all
   four reach `SecretSynced` (step B4).

---

## Phase 6 - Deploy the services and expose them (guide 06 steps 3-5)

1. **Service manifests** (20-25): substitute `<ACCOUNT_ID>`, `<REGION>`,
   `<IMAGE_TAG>`, and the `<..._DB_ENDPOINT>` values, then apply. Guide 06 step 3
   has the `sed` one-liners and the endpoint lookups.
   - matching-service also needs the Redis endpoint (from stack 05 / guide 07).
   - notification-worker needs the SQS queue URL + its IRSA role (stack 05 /
     guide 08).
2. **Ingress** (30): `kubectl apply -f iac/k8s/30-ingress.yaml`. The ALB
   controller provisions the internet-facing ALB.
3. **Verify end to end:**
   ```bash
   ADDR=$(kubectl get ingress ridenow -n ridenow \
     -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
   curl -s "http://$ADDR/api/drivers"
   ```
   A JSON response = backend running on EKS Fargate. **Done.**

---

## Phase 7 - Wire the async + Redis features (guides 07, 08)

Stack 05 already created Redis, the SQS queue/DLQ, and the EventBridge bus. These
guides set the per-pod env + IRSA so matching-service and notification-worker use
them:

- `07-later-elasticache-redis.md` — point driver/matching at the Redis endpoint.
- `08-later-sqs-eventbridge.md` — bus/queue/rule env + the worker's IRSA role.

---

## Phase 8 - Observability (guide 06a)

Fargate-appropriate: the **AMP agentless scraper** (pod metrics) and the **Fargate
log router** (pod logs), plus control-plane logs. No DaemonSet agents. Full setup,
dashboards, alert rules, and failure simulations are in `06a-observability.md`.

---

## Quick order summary

```
deploy.sh prod --apply        # stacks 01->07 (OIDC auto-resolved for 07)
  └─ (03 done) push images     # Phase 2
update-kubeconfig
patch CoreDNS                  # Phase 3
Helm: ALB controller, ESO + KMS grant   # Phase 4  (needs 07's roles)
namespace, per-pod SGs, log router, ExternalSecrets   # Phase 5
service manifests 20-25, ingress 30     # Phase 6
Redis + SQS env wiring (07, 08)         # Phase 7
observability (06a)                     # Phase 8
```

---

## Teardown

Two scripts, in this order. The in-cluster cleanup **must** run first — the ALB
created by the Ingress holds ENIs in the subnets and will block the network stack
(02) from deleting otherwise.

```bash
# 1. In-cluster + hand-created resources (ALB, workloads, Helm add-ons,
#    per-service SGs). Dry-run first, then --apply.
./iac/scripts/cleanup-cluster.sh prod
./iac/scripts/cleanup-cluster.sh prod --apply

# 2. CloudFormation stacks, reverse order 07 -> 01.
./iac/scripts/teardown.sh prod
./iac/scripts/teardown.sh prod --apply
```

Both scripts are dry-run by default and prompt for confirmation on `prod`.
`cleanup-cluster.sh` is best-effort (it keeps going if a resource is already
gone). RDS has `DeletionProtection=false` with `DeletionPolicy=Snapshot`, so the
data stack deletes cleanly and leaves a final snapshot.
