# 06 - Deploy RideNow to EKS and expose it

Goal: run the services on the cluster and reach them from the internet through a
single ALB. By the end, `GET /api/drivers` works from your browser against an AWS
load balancer. This is the "done" line for the backend-on-EKS goal.

Time: ~30 min. Cost: the ALB bills hourly while it exists.

The manifests live in `../../iac/k8s/`. You'll fill in three placeholders
(`<ACCOUNT_ID>`, `<REGION>`, each `<..._DB_ENDPOINT>`) and apply them.

---

## Cluster layout

This guide uses a single shared node group for everything:

```
ridenow-dev-nodes  (t3.medium × 2–3, autoscaled)
  ├── kube-system        ALB controller, cluster-autoscaler, CoreDNS, metrics-server
  ├── amazon-cloudwatch  CloudWatch agent, OTel operator, kube-state-metrics
  ├── external-dns
  ├── external-secrets
  └── ridenow            your 6 services (2 replicas each, HPA up to 6)
```

Add-ons and services compete for the same nodes. The cluster autoscaler (step 1c)
adds a third node whenever pods are `Pending` due to capacity.

**Production difference.** In prod you'd split into three node groups with taints
so system add-ons and application pods never compete for capacity:

| Node group | Taint | What runs there |
|---|---|---|
| `system-nodes` | `dedicated=system:NoSchedule` | All add-ons and controllers |
| `app-nodes` | _(none)_ | Your 6 microservices |
| `worker-nodes` (Spot) | `dedicated=worker:NoSchedule` | notification-worker, batch jobs |

Each add-on Helm chart accepts a `tolerations` value to target the system nodes;
each service Deployment gets a `nodeSelector` or affinity rule. That separation
isn't needed at dev scale — one node group is the right starting point.

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

### 1c. Install the Cluster Autoscaler

Without the autoscaler, EKS never adds nodes even though the node group allows up
to 3. System add-ons (CloudWatch, OTel, external-dns, ESO) consume enough pod
slots on 2 nodes that service pods get stuck `Pending`. Install the autoscaler
once so the node group scales itself whenever capacity runs out.

**Deploy the `07-eks-addons` stack** — this single stack creates all three IRSA
roles the cluster needs: ALB controller, External Secrets Operator, and cluster
autoscaler. Run it once here; later steps just read its exports.

```bash
OIDC_ID=$(aws eks describe-cluster \
  --name ridenow \
  --region ap-southeast-1 \
  --query "cluster.identity.oidc.issuer" \
  --output text --no-cli-pager | sed 's|.*/||')
echo "OIDC ID: $OIDC_ID"

aws cloudformation deploy \
  --stack-name ridenow-dev-eks-addons \
  --template-file iac/stacks/07-eks-addons.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=dev \
    EnableAddons=true \
    OidcProviderId=$OIDC_ID \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Retrieve the autoscaler role ARN** from the stack export:

```bash
CA_ROLE_ARN=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-eks-ClusterAutoscalerRoleArn'].Value" \
  --output text --no-cli-pager)
echo "Autoscaler Role ARN: $CA_ROLE_ARN"
```

**Install the Cluster Autoscaler via Helm:**

```bash
# Match the major.minor version to your EKS cluster version
EKS_VERSION=$(aws eks describe-cluster \
  --name ridenow \
  --region ap-southeast-1 \
  --query "cluster.version" \
  --output text --no-cli-pager)
echo "EKS version: $EKS_VERSION"   # e.g. 1.31

helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm repo update

helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  -n kube-system \
  --set fullnameOverride=cluster-autoscaler \
  --set autoDiscovery.clusterName=ridenow \
  --set awsRegion=ap-southeast-1 \
  --set rbac.serviceAccount.create=true \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set "rbac.serviceAccount.annotations.eks\.amazonaws\.com/role-arn=${CA_ROLE_ARN}" \
  --set image.tag=v${EKS_VERSION}.0 \
  --set extraArgs.balance-similar-node-groups=true \
  --set extraArgs.skip-nodes-with-system-pods=false
```

> **Version note:** the autoscaler image tag must match your EKS minor version
> (e.g. EKS 1.31 → `v1.31.0`). If `v${EKS_VERSION}.0` doesn't exist yet, check
> the latest patch at https://github.com/kubernetes/autoscaler/releases and pass
> it explicitly with `--set image.tag=v1.31.x`.

**Tag the node group's Auto Scaling Group** so the autoscaler can discover it:

```bash
# Get the actual EKS node group name dynamically
NODEGROUP=$(aws eks list-nodegroups \
  --cluster-name ridenow \
  --region ap-southeast-1 \
  --query "nodegroups[0]" \
  --output text)

echo "Node Group: $NODEGROUP"

# Get the ASG name backing that node group
ASG_NAME=$(aws eks describe-nodegroup \
  --cluster-name ridenow \
  --nodegroup-name "$NODEGROUP" \
  --region ap-southeast-1 \
  --query "nodegroup.resources.autoScalingGroups[0].name" \
  --output text)

echo "ASG: $ASG_NAME"

# Validate
if [ -z "$ASG_NAME" ] || [ "$ASG_NAME" = "None" ]; then
  echo "ERROR: ASG not found"
  exit 1
fi

# Tag ASG
aws autoscaling create-or-update-tags \
  --tags \
    "ResourceId=${ASG_NAME},ResourceType=auto-scaling-group,Key=k8s.io/cluster-autoscaler/enabled,Value=true,PropagateAtLaunch=false" \
    "ResourceId=${ASG_NAME},ResourceType=auto-scaling-group,Key=k8s.io/cluster-autoscaler/ridenow,Value=owned,PropagateAtLaunch=false" \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Verify the autoscaler is running:**

```bash
kubectl get deploy -n kube-system cluster-autoscaler
# NAME                 READY   UP-TO-DATE   AVAILABLE
# cluster-autoscaler   1/1     1            1

kubectl logs -n kube-system deploy/cluster-autoscaler --tail=10
# Should show: "Starting main loop" with no credential errors
```

Once running, whenever a pod is `Pending` due to insufficient capacity the
autoscaler adds a node (up to `maxSize: 3`). Scale-down happens automatically
after 10 minutes of a node being underutilised.

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
   `iac/k8s/10-external-secrets.yaml` expects).

   **B1. Confirm the `07-eks-addons` stack is deployed** — it was run in step 1c
   and already created the ESO IRSA role. Retrieve its ARN and grant it KMS
   decrypt access on the RDS key. RDS-managed secrets are encrypted with the
   stack's KMS key; without this grant the operator gets `Access to KMS is not
   allowed` even after the Secrets Manager policy is correct.

   ```bash
   ESO_ROLE_ARN=$(aws cloudformation list-exports \
     --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-dev-eks-ExternalSecretsRoleArn'].Value" \
     --output text --no-cli-pager)
   echo "ESO Role ARN: $ESO_ROLE_ARN"

   KMS_KEY_ARN=$(aws kms describe-key \
     --key-id alias/ridenow-dev-rds \
     --region ap-southeast-1 \
     --query KeyMetadata.Arn \
     --output text --no-cli-pager)
   echo "KMS Key ARN: $KMS_KEY_ARN"

   aws kms create-grant \
     --key-id "$KMS_KEY_ARN" \
     --grantee-principal "$ESO_ROLE_ARN" \
     --operations Decrypt DescribeKey \
     --name "eso-decrypt-grant" \
     --region ap-southeast-1 \
     --no-cli-pager
   ```

   **B2. Install the External Secrets Operator via Helm:**

   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm repo update

   # Create the namespace and install the operator; annotate its service account
   # with the IRSA role so it can call Secrets Manager without static keys.
   helm install external-secrets external-secrets/external-secrets \
     -n external-secrets \
     --create-namespace \
     --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$ESO_ROLE_ARN \
     --wait
   ```

   Verify the operator pods are running:

   ```bash
   kubectl get pods -n external-secrets
   # NAME                                READY   STATUS    RESTARTS
   # external-secrets-...                1/1     Running   0
   # external-secrets-cert-controller... 1/1     Running   0
   # external-secrets-webhook-...        1/1     Running   0
   ```

   Then confirm the CRDs are registered before applying the manifests — the
   `ClusterSecretStore` and `ExternalSecret` kinds must exist or `kubectl apply`
   will fail with "no matches for kind":

   ```bash
   kubectl get crd | grep external-secrets.io
   # clustersecretstores.external-secrets.io     ...
   # externalsecrets.external-secrets.io         ...
   # secretstores.external-secrets.io            ...
   ```

   If any are missing, the operator is still starting up. Wait a few seconds and
   re-run until all three appear.

   **B3. Apply `10-external-secrets.yaml`** after substituting the placeholders.
   First get the secret ARNs — these are the RDS-managed secrets whose names are
   auto-generated by AWS and not predictable. The stack exports the ARNs:

   ```bash
   aws cloudformation list-exports \
     --region ap-southeast-1 \
     --query "Exports[?starts_with(Name,'ridenow-dev-data-') && ends_with(Name,'SecretArn')].{Name:Name,Value:Value}" \
     --output table --no-cli-pager
   # +------------------------------------+----------------------------------------------------------+
   # | ridenow-dev-data-UserDbSecretArn   | arn:aws:secretsmanager:...:secret:ridenow-dev-user-db-Xx |
   # | ridenow-dev-data-DriverDbSecretArn | arn:aws:secretsmanager:...:secret:ridenow-dev-driver-db-Xx|
   # | ridenow-dev-data-TripDbSecretArn   | arn:aws:secretsmanager:...:secret:ridenow-dev-trip-db-Xx  |
   # | ridenow-dev-data-PaymentDbSecretArn| arn:aws:secretsmanager:...:secret:ridenow-dev-payment-db-Xx|
   ```

   Then substitute all placeholders and apply:

   ```bash
   USER_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-dev-data-UserDbSecretArn'].Value" \
     --output text --no-cli-pager)
   DRIVER_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-dev-data-DriverDbSecretArn'].Value" \
     --output text --no-cli-pager)
   TRIP_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-dev-data-TripDbSecretArn'].Value" \
     --output text --no-cli-pager)
   PAYMENT_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-dev-data-PaymentDbSecretArn'].Value" \
     --output text --no-cli-pager)

   sed -e "s|<REGION>|ap-southeast-1|g" \
       -e "s|<USER_SECRET_ARN>|${USER_ARN}|g" \
       -e "s|<DRIVER_SECRET_ARN>|${DRIVER_ARN}|g" \
       -e "s|<TRIP_SECRET_ARN>|${TRIP_ARN}|g" \
       -e "s|<PAYMENT_SECRET_ARN>|${PAYMENT_ARN}|g" \
       iac/k8s/10-external-secrets.yaml | kubectl apply -f -
   ```

   **B4. Verify the secrets were synced** from Secrets Manager into the cluster:

   ```bash
   # Each ExternalSecret should show READY = True
   kubectl get externalsecret -n ridenow
   # NAME                       STORE             REFRESH INTERVAL   STATUS   READY
   # driver-db-credentials      ridenow-secrets   1h                 SecretSynced   True
   # user-db-credentials        ridenow-secrets   1h                 SecretSynced   True
   # ...

   # Confirm the k8s Secrets exist
   kubectl get secret -n ridenow
   ```

   If any `ExternalSecret` shows `SecretSyncedError`, the describe output only
   shows "could not get secret data from provider" — the real error is in the
   ESO pod logs:

   ```bash
   kubectl logs -n external-secrets deploy/external-secrets --tail=50 \
     | grep -i "error\|denied\|forbidden\|secret"
   ```

   **Common causes and fixes:**

   - **`Access to KMS is not allowed`** — the most likely cause when using RDS
     managed passwords. RDS encrypts each secret with a dedicated KMS key. The
     ESO IRSA role has `secretsmanager:GetSecretValue` but not `kms:Decrypt` on
     the RDS KMS key. Fix by adding a KMS grant. Get the key ARN from the data
     stack export and grant decrypt to the ESO role:

     ```bash
     KMS_KEY_ARN=$(aws kms describe-key \
       --key-id alias/ridenow-dev-rds \
       --region ap-southeast-1 \
       --query KeyMetadata.Arn \
       --output text --no-cli-pager)

     ESO_ROLE_ARN=$(aws cloudformation list-exports \
       --region ap-southeast-1 \
       --query "Exports[?Name=='ridenow-dev-eks-ExternalSecretsRoleArn'].Value" \
       --output text --no-cli-pager)

     aws kms create-grant \
       --key-id "$KMS_KEY_ARN" \
       --grantee-principal "$ESO_ROLE_ARN" \
       --operations Decrypt DescribeKey \
       --name "eso-decrypt-grant" \
       --region ap-southeast-1 \
       --no-cli-pager
     ```

     After granting, force an immediate re-sync:

     ```bash
     kubectl annotate externalsecret user-db-credentials driver-db-credentials \
       trip-db-credentials payment-db-credentials \
       -n ridenow \
       force-sync=$(date +%s) --overwrite
     ```

   - **`ResourceNotFoundException`** — the ARN substitution didn't work and the
     placeholder is still in the manifest. Check with:
     `kubectl get externalsecret user-db-credentials -n ridenow -o yaml | grep key`
     and re-run the `sed` command if you still see `<USER_SECRET_ARN>`.

   - **IRSA not wired up** — the service account annotation is missing. Verify:
     `kubectl get sa external-secrets -n external-secrets -o yaml | grep role-arn`

   Once all are `SecretSynced`, the operator refreshes them automatically every hour.

---

## 2.5. Per-pod security groups (production)

> **Dev shortcut:** if you're running a dev cluster on `t3.medium` nodes, skip
> this step and instead allow the EKS cluster SG on the DB security group
> (one-liner at the end of this section). The full per-pod setup requires
> `t3.large` or larger nodes.

In production each service pod must have its own SG so it can only reach its own
database — a driver-service pod must be physically blocked from reaching the user
database at the network level.

**1. Enable pod ENI on the VPC CNI addon:**

```bash
kubectl set env daemonset aws-node \
  -n kube-system \
  ENABLE_POD_ENI=true

kubectl rollout status daemonset/aws-node -n kube-system
```

**2. Create one SG per service and wire it to that service's DB only:**

```bash
VPC_ID=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-network-VpcId'].Value" \
  --output text --no-cli-pager)

DB_SG=sg-0b0fe43a64932a237   # ridenow DB security group

for SVC in user driver trip payment; do
  SG_ID=$(aws ec2 create-security-group \
    --group-name ridenow-dev-${SVC}-service-sg \
    --description "${SVC}-service pods" \
    --vpc-id $VPC_ID \
    --region ap-southeast-1 \
    --query GroupId --output text --no-cli-pager)
  echo "${SVC}-service SG: $SG_ID"

  # Allow only this SG to reach port 5432 on the DB SG
  aws ec2 authorize-security-group-ingress \
    --group-id $DB_SG \
    --protocol tcp \
    --port 5432 \
    --source-group $SG_ID \
    --region ap-southeast-1 \
    --no-cli-pager
done
```

Record the four SG IDs printed above — you need them in the next step.

**3. Create `iac/k8s/40-security-group-policies.yaml`** replacing each
`sg-XXXXXXXX` with the SG ID for that service:

```yaml
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata:
  name: user-service-sgp
  namespace: ridenow
spec:
  podSelector:
    matchLabels:
      app: user-service
  securityGroups:
    securityGroupIds:
      - sg-XXXXXXXX   # user-service SG
---
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata:
  name: driver-service-sgp
  namespace: ridenow
spec:
  podSelector:
    matchLabels:
      app: driver-service
  securityGroups:
    securityGroupIds:
      - sg-YYYYYYYY   # driver-service SG
---
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata:
  name: trip-service-sgp
  namespace: ridenow
spec:
  podSelector:
    matchLabels:
      app: trip-service
  securityGroups:
    securityGroupIds:
      - sg-ZZZZZZZZ   # trip-service SG
---
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata:
  name: payment-service-sgp
  namespace: ridenow
spec:
  podSelector:
    matchLabels:
      app: payment-service
  securityGroups:
    securityGroupIds:
      - sg-WWWWWWWW   # payment-service SG
```

```bash
kubectl apply -f iac/k8s/40-security-group-policies.yaml
```

Policies must exist before pods start — pods that launched before the policy was
applied won't pick it up until they restart.

After deploying the services (step 3), remove the broad cluster SG rule that was
added as a dev workaround:

```bash
# Only run this after per-pod SGs are confirmed working
aws ec2 revoke-security-group-ingress \
  --group-id sg-0b0fe43a64932a237 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-0676dd75784f7f89d \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Dev shortcut** — if skipping per-pod SGs, just allow the cluster SG on the DB:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-0b0fe43a64932a237 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-0676dd75784f7f89d \
  --region ap-southeast-1 \
  --no-cli-pager
```

---

## 3. Fill placeholders and deploy the services

The Deployment manifests in `iac/k8s/` carry placeholders. Replace them with your
real values (a quick `sed`, or edit by hand):

- `<ACCOUNT_ID>` -> your 12-digit account id
- `<REGION>` -> `ap-southeast-1`
- `<IMAGE_TAG>` -> the tag you pushed in guide 03 (`local` or `v1.0.0`)
- `<USER_DB_ENDPOINT>`, `<DRIVER_DB_ENDPOINT>`, ... -> the RDS endpoints (guide 04)

**What each manifest already ships — no extra work needed:**

- **`replicas: 2`** — two pods per service so a single node drain or pod crash
  doesn't cause downtime.
- **Resource requests and limits** — every container declares:
  ```yaml
  resources:
    requests:
      cpu: "250m"
      memory: "512Mi"
    limits:
      cpu: "1000m"
      memory: "1Gi"
  ```
  Requests tell the scheduler how much capacity to reserve; limits cap runaway
  processes. Without requests the autoscaler can't make correct scale decisions.
- **HorizontalPodAutoscaler** — each manifest includes an HPA that scales between
  2 and 6 replicas when average CPU crosses 70 %:
  ```yaml
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  ```
  The HPA needs `metrics-server` running in `kube-system` to read pod CPU — it's
  already installed by the observability stack (guide 06a).

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

Once all pods are Running, confirm the HPAs are active:

```bash
kubectl get hpa -n ridenow
# NAME              REFERENCE                    TARGETS   MINPODS   MAXPODS   REPLICAS
# driver-service    Deployment/driver-service    8%/70%    2         6         2
# user-service      Deployment/user-service      5%/70%    2         6         2
# ...
# TARGETS shows current CPU% / threshold. While idle, all stay at minReplicas: 2.
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

## Production readiness checklist

What this guide already sets up vs. what you'd add before going to production:

| Concern | This guide (dev) | Production addition |
|---|---|---|
| Availability | `replicas: 2` per service | Add a `PodDisruptionBudget` (`maxUnavailable: 1`) so node drains don't take a service fully down |
| Autoscaling | HPA on CPU 70 %, min 2 / max 6 | Tune thresholds per service; consider memory or custom metrics for I/O-heavy services |
| Node capacity | Single shared node group, autoscaler up to 3 | Split into system / app / worker node groups with taints (see Cluster layout section above) |
| Cost | On-demand t3.medium | Move notification-worker to a Spot node group (`dedicated=worker:NoSchedule`) |
| Secrets | ESO syncs from Secrets Manager every 1 h | Enable RDS managed password rotation; ESO picks up the new value automatically |
| IAM | IRSA per service account | Audit and scope each role to the minimum set of actions and resources |
| Network isolation | Cluster SG allowed on all DBs | Per-pod SGs via `SecurityGroupPolicy` so each service can only reach its own DB (see below) |
| TLS | Plain HTTP through ALB | Attach an ACM certificate to the ALB listener; add WAF for public endpoints |
| Image tags | `local` / `v1.0.0` | Use immutable SHA digests (`image@sha256:...`) in CI/CD to prevent tag mutation |
| Observability | CloudWatch + OTel (guide 06a) | Set log retention policies; add alarms on 5xx rates and pod restart counts |

The three highest-value items to tackle first are PodDisruptionBudgets, TLS on the
ALB, and locking image tags to digests — the rest can follow incrementally.

---

## Clean up

- `kubectl delete -f iac/k8s/30-ingress.yaml` first (this removes the ALB - it
  bills hourly), then the service manifests and namespace.
- Then tear down the cluster/node group (guide 05) and RDS (guide 04).

Next (optional features): `07-later-elasticache-redis.md`, `08-later-sqs-eventbridge.md`.
