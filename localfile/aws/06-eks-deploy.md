# 06 - Deploy RideNow to EKS and expose it

Goal: run the services on the cluster and reach them from the internet through a
single ALB. By the end, `GET /api/drivers` works from your browser against an AWS
load balancer. This is the "done" line for the backend-on-EKS goal.

Time: ~30 min. Cost: the ALB bills hourly while it exists.

The manifests live in `../../iac/k8s/`. You'll fill in three placeholders
(`<ACCOUNT_ID>`, `<REGION>`, each `<..._DB_ENDPOINT>`) and apply them.

---

## 1. Install the AWS Load Balancer Controller

The ALB Ingress (step 4) needs this controller running in the cluster. It reads
the Ingress annotations and provisions a real ALB.

### 1a. Create its IRSA role

1. Download the controller's IAM policy JSON and create the policy:

   ```bash
   curl -O https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.11.0/docs/install/iam_policy.json

   aws iam create-policy \
     --policy-name AWSLoadBalancerControllerIAMPolicy \
     --policy-document file://iam_policy.json \
     --region ap-southeast-1 \
     --no-cli-pager
   ```
2. IAM -> **Roles** -> **Create role** -> **Web identity**.
   - Identity provider: the cluster's **OIDC provider** (guide 05 Part D).
   - Audience: `sts.amazonaws.com`.
3. Attach `AWSLoadBalancerControllerIAMPolicy`. Name the role
   `ridenow-alb-controller-role`.
4. Edit the role's **trust policy** so the `sub` is scoped to the controller's
   service account:
   `system:serviceaccount:kube-system:aws-load-balancer-controller`.

### 1b. Install the controller (Helm)

**Prerequisites — install Helm on Linux (WSL or EC2) if not already installed:**

```bash
# Download and install Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
# Expected: version.BuildInfo{Version:"v3.x.x", ...}
```

**Add the EKS chart repo and install the controller:**

```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Get your VPC ID from the CloudFormation export (or paste it directly)
VPC_ID=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-network-VpcId'].Value" \
  --output text --no-cli-pager)
echo "VPC ID: $VPC_ID"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
echo "Account ID: $ACCOUNT_ID"

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=ridenow \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=arn:aws:iam::${ACCOUNT_ID}:role/ridenow-alb-controller-role" \
  --set region=ap-southeast-1 \
  --set vpcId=${VPC_ID}
```

**Verify the controller is running:**

```bash
kubectl get deploy -n kube-system aws-load-balancer-controller
# NAME                           READY   UP-TO-DATE   AVAILABLE
# aws-load-balancer-controller   1/1     1            1

kubectl logs -n kube-system \
  deploy/aws-load-balancer-controller \
  --tail=20
# Should show: "Starting EventRecordingController" with no errors
```

---

## 2. Namespace and database Secrets

1. Create the namespace:

   ```bash
   kubectl apply -f iac/k8s/00-namespace.yaml   # creates namespace "ridenow"
   ```

2. Get each service's DB credentials into the cluster. Two options:

   **Option A - quick, by hand** (fine for a lab). For each service, read the
   username/password from its Secrets Manager secret (guide 04) and create a k8s
   Secret the Deployment expects:

   ```bash
   kubectl create secret generic driver-db-credentials -n ridenow \
     --from-literal=username='driver' \
     --from-literal=password='<the password from Secrets Manager>'
   ```

   Repeat for `user-db-credentials`, `trip-db-credentials`,
   `payment-db-credentials`, `matching-db-credentials`,
   `notification-db-credentials` (the Deployments reference these names).

   **Option B - External Secrets Operator** (closer to production; what
   `iac/k8s/10-external-secrets.yaml` expects). Install the operator, give its
   service account an IRSA role that can read the RDS secrets, then apply
   `10-external-secrets.yaml` (replace `<ENV>`/`<REGION>` first). The operator
   syncs Secrets Manager -> k8s Secrets automatically.

---

## 3. Fill placeholders and deploy the services

The Deployment manifests in `iac/k8s/` carry placeholders. Replace them with your
real values (a quick `sed`, or edit by hand):

- `<ACCOUNT_ID>` -> your 12-digit account id
- `<REGION>` -> `ap-southeast-1`
- `<IMAGE_TAG>` -> the tag you pushed in guide 03 (`local` or `v1.0.0`)
- `<USER_DB_ENDPOINT>`, `<DRIVER_DB_ENDPOINT>`, ... -> the RDS endpoints (guide 04)

Example with sed for one file:

```bash
sed -e 's/<ACCOUNT_ID>/123456789012/' \
    -e 's/<REGION>/ap-southeast-1/' \
    -e 's/<IMAGE_TAG>/local/' \
    -e 's/<DRIVER_DB_ENDPOINT>/ridenow-driver.abcd.ap-southeast-1.rds.amazonaws.com/' \
    iac/k8s/21-driver-service.yaml | kubectl apply -f -
```

Apply the four provided services:

```bash
# after substituting placeholders in each:
kubectl apply -f iac/k8s/20-user-service.yaml
kubectl apply -f iac/k8s/21-driver-service.yaml
kubectl apply -f iac/k8s/22-trip-service.yaml
kubectl apply -f iac/k8s/23-payment-service.yaml

kubectl get pods -n ridenow -w   # watch them reach Running + READY
```

Readiness is gated by `/actuator/health`, which is UP only once the DB connection
and Flyway migration succeed - so a pod stuck in `0/1` usually means the DB
endpoint, secret, or security group is wrong.

### 3a. Deploy the two newer services

`iac/k8s/` now also ships `24-matching-service.yaml` and
`25-notification-worker.yaml`. Substitute their placeholders and apply:

```bash
# matching-service also needs <MATCHING_DB_ENDPOINT> and <REDIS_ENDPOINT>
# (the Redis endpoint comes from guide 07; before then, leave it and matching
#  simply can't answer GEO queries yet - everything else runs):
kubectl apply -f iac/k8s/24-matching-service.yaml   # after substitution

# notification-worker also needs <NOTIFICATION_DB_ENDPOINT>,
# <NOTIFICATIONS_QUEUE_URL> and <NOTIFICATION_WORKER_ROLE_ARN> (queue + IRSA
# role from guide 08; before then it starts healthy and idles):
kubectl apply -f iac/k8s/25-notification-worker.yaml   # after substitution
```

Notes baked into those manifests:
- **matching-service** is an internal ClusterIP Service (no Ingress entry); it
  carries `REDIS_HOST/PORT` and `MATCHING_FINDER=redis`.
- **notification-worker** has **no Service/Ingress** (only a health probe) and
  ships a **ServiceAccount** annotated for IRSA so it can read SQS without static
  keys - you fill in `<NOTIFICATION_WORKER_ROLE_ARN>` in guide 08.

---

## 4. Expose the services through the ALB Ingress

```bash
kubectl apply -f iac/k8s/30-ingress.yaml
kubectl get ingress -n ridenow -w
```

The controller provisions an internet-facing ALB in the public subnets and fills
in the Ingress **ADDRESS** (an `*.elb.amazonaws.com` hostname). It routes:

- `/api/users`    -> user-service:8081
- `/api/drivers`  -> driver-service:8080
- `/api/trips`    -> trip-service:8082
- `/api/payments` -> payment-service:8083

(matching-service is internal - reached in-cluster by other services; the worker
has no HTTP route. Add `/api/matching` to the Ingress only if you want it public.)

---

## 5. Verify end to end

```bash
ADDR=$(kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -s "http://$ADDR/api/drivers"      # a JSON page of drivers (from RDS)
curl -s "http://$ADDR/api/trips"        # a JSON page of trips
```

A JSON response through the ALB means: image pulled from ECR, pod healthy on EKS,
connected to its RDS, reachable via the load balancer. That's the backend running
on EKS - **done**.

---

## Clean up

- `kubectl delete -f iac/k8s/30-ingress.yaml` first (this removes the ALB - it
  bills hourly), then the service manifests and namespace.
- Then tear down the cluster/node group (guide 05) and RDS (guide 04).

Next (optional features): `07-later-elasticache-redis.md`, `08-later-sqs-eventbridge.md`.
