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
# 0. Static checks (no AWS calls): stacks, manifests, params and guides agree.
./iac/scripts/check-consistency.sh
# 1. Dry run (SAFE): emits a change set per stack, creates nothing.
./iac/scripts/deploy.sh prod

# 2. Apply independent stacks at the same time (about 30 min faster):
./iac/scripts/deploy.sh prod --apply --parallel
```

**This step is slow, and the script is built for that.**

| Slow resource | Typical wait |
|---|---|
| 02 network (2 NAT gateways) | 3-5 min |
| 04 data (6 RDS instances) | 10-20 min |
| 05 messaging (Valkey replication group) | 10-15 min |
| 06 EKS cluster + Fargate profiles | 10-15 min |

- `--parallel` runs three phases: (01, 02, 03), then (04, 05, 06), then 07. Stacks
  in a phase do not depend on each other. Each stack's output is printed in order
  once the phase finishes, and the run stops if any stack failed.
- **Safe to re-run.** A stack with no changes is skipped, so an interrupted run
  resumes at the first unfinished stack.
- **A failed first create** leaves the stack in `ROLLBACK_COMPLETE`, which cannot
  be updated. The script prints the failed events (which resource, and why) and
  stops. After you read them, run `RIDENOW_DELETE_ROLLBACK=1 ./iac/scripts/deploy.sh
  prod --apply [--parallel]` to delete that stack and retry.
- The CLI waits up to 60 minutes per stack. If your terminal or CI job has a
  shorter limit, start the script in the background (or in `tmux`) and check the
  CloudFormation console or `aws cloudformation describe-stacks` for progress.

What this provisions, in order:

| Stack | Creates | Notes |
|-------|---------|-------|
| 01-iam | Cluster role + Fargate pod execution role + app-access policy + one messaging policy per service | messaging policies attach to 07's roles |
| 02-network | 2-AZ VPC, NAT per AZ, cluster SG, DB SG | — |
| 03-ecr | One repo per service | **images come in Phase 2** |
| 04-data | 6 RDS instances (user, driver, trip, payment, matching, notification) + Secrets Manager secrets | pods need these to be healthy; realtime-gateway has no database |
| 05-messaging | SNS topic; matching / payment / notifications queues + DLQs; one filtered subscription per queue (raw delivery, filter on `type`); ElastiCache for Valkey | consumed by matching / payment / worker |
| 06-eks-cluster | EKS control plane + 3 Fargate profiles | **no node group** |
| 07-eks-addons | ALB-controller + External-Secrets IRSA roles, plus trip / payment / matching / notification-worker IRSA roles | OIDC id injected automatically |

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

## Phase 2 - Build and push images

ECR repos exist (stack 03) but are empty. Build and push before deploying any
service manifest, or pods will `ImagePullBackOff`.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
REGION=ap-southeast-1
IMAGE_TAG=v1.0.0

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  docker buildx build --platform linux/amd64 \
    -t ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/ridenow/$SVC:$IMAGE_TAG \
    --push $SVC/
done
```

Verify each repo has the `v1.0.0` tag:

```bash
for SVC in user-service driver-service trip-service payment-service matching-service notification-worker realtime-gateway; do
  echo -n "$SVC: "; aws ecr describe-images --repository-name ridenow/$SVC --image-ids imageTag=v1.0.0 --query 'imageDetails[0].imageTags' --output text
done
```

---

## Phase 3 - Make the cluster usable

Fargate has no nodes. CoreDNS pods stay `Pending` ("no nodes available") in two
cases, and both are fixed by recreating them once the `kube-system` Fargate profile
is **Active**:

- the CoreDNS template still carries the annotation that pins it to EC2 (remove it);
- the pods were created before the Fargate profile existed (stack 06 creates the
  cluster first and the profiles one at a time). A pod is matched to a profile only
  when it is created, so these pods never move to Fargate on their own. The
  annotation can already be gone in this case, and the restart alone is the fix.

```bash
# Remove the EC2 pin only if it is still there (the patch fails when it is not).
if kubectl get deployment coredns -n kube-system \
     -o jsonpath='{.spec.template.metadata.annotations}' | grep -q compute-type; then
  kubectl patch deployment coredns -n kube-system --type=json \
    -p='[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'
fi
# Always recreate the pods, so they are scheduled on the now-Active profile.
kubectl rollout restart deployment coredns -n kube-system
kubectl rollout status  deployment coredns -n kube-system
```

Stack 07 registers the cluster's OIDC provider in IAM (the IRSA roles trust it), so
there is nothing to enable here. To confirm it exists:

```bash
ISSUER_ID=$(aws eks describe-cluster --name ridenow-prod --region ap-southeast-1 \
  --query 'cluster.identity.oidc.issuer' --output text | sed 's|.*/||')
aws iam list-open-id-connect-providers --output text | grep "$ISSUER_ID" \
  && echo "OIDC provider present" || echo "missing: re-run ./iac/scripts/deploy.sh prod --apply"
```

If it is missing, stack 07 was deployed before the cluster existed, which leaves it
empty. Re-run `./iac/scripts/deploy.sh prod --apply`. Do not create the provider by
hand or with `eksctl`: a provider created outside the stack makes stack 07 fail with
`EntityAlreadyExists`.

---

## Phase 4 - In-cluster add-ons (Helm)

Needs the IRSA roles from stack 07. Order matters.

Paste this helper once per terminal. Phases 4 to 6 use it.

```bash
export AWS_DEFAULT_REGION=ap-southeast-1 AWS_PAGER=""
exp() { aws cloudformation list-exports --query "Exports[?Name=='ridenow-prod-$1'].Value" --output text; }
```

### 4.1 AWS Load Balancer Controller

```bash
helm repo add eks https://aws.github.io/eks-charts && helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=ridenow-prod \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$(exp eks-AlbControllerRoleArn)" \
  --set region=ap-southeast-1 \
  --set vpcId=$(exp network-VpcId)

# attach the controller's IAM policy (without it the Ingress gets no address)
./iac/scripts/alb-controller-policy.sh prod

kubectl get deploy -n kube-system aws-load-balancer-controller   # expect 1/1
```

### 4.2 External Secrets Operator

```bash
ESO_ROLE_ARN=$(exp eks-ExternalSecretsRoleArn)

# let ESO decrypt the RDS secrets (skip if the grant already exists)
aws kms create-grant \
  --key-id $(aws kms describe-key --key-id alias/ridenow-prod-rds --query KeyMetadata.Arn --output text) \
  --grantee-principal "$ESO_ROLE_ARN" \
  --operations Decrypt DescribeKey \
  --name eso-decrypt-grant

helm repo add external-secrets https://charts.external-secrets.io && helm repo update

# webhook.port=9443 is required on Fargate (the default 10250 clashes with the kubelet)
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$ESO_ROLE_ARN \
  --set webhook.port=9443 \
  --wait

kubectl get pods -n external-secrets     # expect 3 pods Running
kubectl get crd | grep external-secrets.io
```

---

## Phase 5 - Namespace, security groups, log router, secrets

Run all four before the service pods start.

### 5.1 Namespace

```bash
kubectl apply -f iac/k8s/00-namespace.yaml
```

### 5.2 Per-pod security groups

Each service gets its own SG, allowed only to its own database. Safe to re-run.

```bash
VPC_ID=$(exp network-VpcId)
DB_SG=$(exp network-DbSecurityGroupId)
CLUSTER_SG=$(exp eks-ClusterSecurityGroupId)   # keep it on every pod: DNS and Redis need it
: > /tmp/sgp.yaml

for SVC in user driver trip payment matching notification; do
  NAME=ridenow-prod-${SVC}-service-sg
  SG_ID=$(aws ec2 describe-security-groups \
    --filters Name=group-name,Values=$NAME Name=vpc-id,Values=$VPC_ID \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [ "$SG_ID" = "None" ]; then
    SG_ID=$(aws ec2 create-security-group --group-name $NAME \
      --description "${SVC}-service pods" --vpc-id $VPC_ID \
      --query GroupId --output text)
  fi
  aws ec2 authorize-security-group-ingress --group-id $DB_SG \
    --protocol tcp --port 5432 --source-group $SG_ID 2>/dev/null || true
  APP=${SVC}-service; [ $SVC = notification ] && APP=notification-worker
  cat >> /tmp/sgp.yaml <<EOF
---
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata:
  name: ${APP}-sgp
  namespace: ridenow
spec:
  podSelector:
    matchLabels:
      app: ${APP}
  securityGroups:
    groupIds:
      - ${SG_ID}
      - ${CLUSTER_SG}
EOF
  echo "$APP -> $SG_ID"
done

kubectl apply -f /tmp/sgp.yaml
kubectl rollout restart deploy -n ridenow     # pods started earlier keep the old SG until restarted
kubectl get securitygrouppolicy -n ridenow     # expect 6
```

### 5.3 Fargate log router

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: aws-observability
  labels:
    aws-observability: enabled
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: aws-logging
  namespace: aws-observability
data:
  flb_log_cw: "true"
  output.conf: |
    [OUTPUT]
        Name cloudwatch_logs
        Match kube.*
        region ap-southeast-1
        log_group_name /aws/eks/ridenow/fargate
        log_stream_prefix fargate-
        auto_create_group true
EOF
```

### 5.4 Database secrets (ExternalSecrets)

```bash
sed -e "s|<REGION>|ap-southeast-1|g" \
    -e "s|<ENV>|prod|g" \
    -e "s|<USER_SECRET_ARN>|$(exp data-UserDbSecretArn)|g" \
    -e "s|<DRIVER_SECRET_ARN>|$(exp data-DriverDbSecretArn)|g" \
    -e "s|<TRIP_SECRET_ARN>|$(exp data-TripDbSecretArn)|g" \
    -e "s|<PAYMENT_SECRET_ARN>|$(exp data-PaymentDbSecretArn)|g" \
    -e "s|<MATCHING_SECRET_ARN>|$(exp data-MatchingDbSecretArn)|g" \
    -e "s|<NOTIFICATION_SECRET_ARN>|$(exp data-NotificationDbSecretArn)|g" \
    iac/k8s/10-external-secrets.yaml | kubectl apply -f -

kubectl get externalsecret -n ridenow    # expect 6 rows: SecretSynced, READY True
```

If a row shows `SecretSyncedError`, read the reason:

```bash
kubectl logs -n external-secrets deploy/external-secrets --tail=50 | grep -i "error\|denied"
```

---

## Phase 6 - Deploy the services and expose them

### 6.1 Services

Set the values that are not in CloudFormation. `APP_ORIGIN` is the browser
origin of the app (never `*`).

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
IMAGE_TAG=v1.0.0
APP_ORIGIN=https://app.example.com
```

Fill in every placeholder and apply. Payment goes first, because trip-service
calls it when a trip is created.

```bash
deploy() {
  sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
      -e "s|<REGION>|ap-southeast-1|g" \
      -e "s|<ENV>|prod|g" \
      -e "s|<IMAGE_TAG>|$IMAGE_TAG|g" \
      -e "s|<APP_ORIGIN>|$APP_ORIGIN|g" \
      -e "s|<REDIS_ENDPOINT>|$(exp messaging-RedisPrimaryEndpoint)|g" \
      -e "s|<USER_DB_ENDPOINT>|$(exp data-UserDbEndpoint)|g" \
      -e "s|<DRIVER_DB_ENDPOINT>|$(exp data-DriverDbEndpoint)|g" \
      -e "s|<TRIP_DB_ENDPOINT>|$(exp data-TripDbEndpoint)|g" \
      -e "s|<PAYMENT_DB_ENDPOINT>|$(exp data-PaymentDbEndpoint)|g" \
      -e "s|<MATCHING_DB_ENDPOINT>|$(exp data-MatchingDbEndpoint)|g" \
      -e "s|<NOTIFICATION_DB_ENDPOINT>|$(exp data-NotificationDbEndpoint)|g" \
      -e "s|<MATCHING_QUEUE_URL>|$(exp messaging-MatchingQueueUrl)|g" \
      -e "s|<PAYMENT_QUEUE_URL>|$(exp messaging-PaymentQueueUrl)|g" \
      -e "s|<NOTIFICATIONS_QUEUE_URL>|$(exp messaging-NotificationQueueUrl)|g" \
      -e "s|<TRIP_SERVICE_ROLE_ARN>|$(exp eks-TripServiceRoleArn)|g" \
      -e "s|<PAYMENT_SERVICE_ROLE_ARN>|$(exp eks-PaymentServiceRoleArn)|g" \
      -e "s|<MATCHING_SERVICE_ROLE_ARN>|$(exp eks-MatchingServiceRoleArn)|g" \
      -e "s|<NOTIFICATION_WORKER_ROLE_ARN>|$(exp eks-NotificationWorkerRoleArn)|g" \
      iac/k8s/$1.yaml | kubectl apply -f -
}

deploy 23-payment-service
deploy 20-user-service
deploy 21-driver-service
deploy 22-trip-service
deploy 24-matching-service
deploy 25-notification-worker
deploy 26-realtime-gateway

kubectl get pods -n ridenow -w     # wait until every pod is Running and 1/1 Ready (Ctrl+C to stop)
```

A pod stuck at `0/1` usually means a wrong DB endpoint, secret, security group or
Redis endpoint. Check with `kubectl describe pod <name> -n ridenow`.

### 6.2 Ingress

```bash
kubectl apply -f iac/k8s/30-ingress.yaml
kubectl get ingress -n ridenow -w     # wait for an ADDRESS (Ctrl+C to stop)
```

### 6.3 Verify

```bash
ADDR=$(kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo $ADDR
curl -s "http://$ADDR/api/drivers"
```

A JSON response means the backend is running on EKS Fargate. A `503` means the
ALB has no healthy target. Check `kubectl get pods -n ridenow` and wait for every
pod to be `Ready`.

---

## Phase 7 - Valkey and SQS/SNS wiring

Nothing more to run. Phase 6 already put the Valkey endpoint, queue URLs and IRSA
role ARNs into the manifests. Confirm the consumers are connected:

```bash
kubectl logs -n ridenow deploy/matching-service --tail=20
kubectl logs -n ridenow deploy/notification-worker --tail=20
```

---

## Phase 8 - Observability

Fargate-appropriate: the **AMP agentless scraper** (pod metrics) and the **Fargate
log router** (pod logs), plus control-plane logs. No DaemonSet agents. Full setup,
dashboards, alert rules, and failure simulations are in `06a-observability.md`.

---

## Quick order summary

```
deploy.sh prod --apply        # stacks 01->07 (OIDC auto-resolved for 07; add --parallel to go faster)
  └─ (03 done) push images     # Phase 2
update-kubeconfig
patch CoreDNS                  # Phase 3
Helm: ALB controller + alb-controller-policy.sh, ESO (webhook.port=9443) + KMS grant   # Phase 4  (needs 07's roles)
namespace, per-pod SGs, log router, ExternalSecrets   # Phase 5
service manifests 20-26, ingress 30     # Phase 6
Valkey + SQS env wiring (07, 08)         # Phase 7
observability (06a)                     # Phase 8
```

---

## Redeploy after the cluster is recreated

Use this when `kubectl` says `no such host`, or the ALB returns `503`. The new
cluster is empty, so you redeploy what runs inside it.

```bash
# 1. Point kubectl at the new cluster
aws eks update-kubeconfig --name ridenow-prod --region ap-southeast-1

# 2. Check it is empty (expect "No resources found")
kubectl get pods,ingress -n ridenow
```

3. Repeat **Phase 3 to Phase 7**. Skip Phase 2 (images are still in ECR).

```bash
# 4. Wait until every pod is Running and Ready
kubectl get pods -n ridenow

# 5. Get the ALB hostname
kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'; echo
```

6. If the hostname changed, update `A=` in `09-manual-walkthrough.md`.

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
