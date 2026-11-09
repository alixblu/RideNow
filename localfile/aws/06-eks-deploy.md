# 06 - Deploy RideNow to EKS and expose it

Goal: run the services on the cluster and reach them from the internet through a
single ALB. By the end, `GET /api/drivers` works from your browser against an AWS
load balancer. This is the "done" line for the backend-on-EKS goal.

Time: ~30 min. Cost: the ALB bills hourly while it exists; Fargate pods bill per
vCPU/memory-second while running.

The manifests live in `../../iac/k8s/`. You'll fill in three placeholders
(`<ACCOUNT_ID>`, `<REGION>`, each `<..._DB_ENDPOINT>`) and apply them.

---

## Cluster layout

Everything runs on **Fargate** — no nodes. Pods are placed by the three Fargate
profiles created in guide 05, matched by namespace:

```
Fargate profiles (serverless — one micro-VM per pod)
  ├── ridenow-system         → kube-system:      ALB controller, CoreDNS, metrics-server
  │                            external-secrets:  External Secrets Operator
  ├── ridenow-observability  → aws-observability: Fargate log router config
  └── ridenow-app            → ridenow:           your 6 services (2 replicas each, HPA up to 6)
```

There is no node capacity to manage and no cluster autoscaler: each pod gets its
own right-sized micro-VM, and the HPA still scales replica count per service.
Pod-to-pod isolation is handled with per-pod security groups (step 2.5), not node
pools or taints.

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
  --query "Exports[?Name=='ridenow-prod-network-VpcId'].Value" \
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

### 1c. Create the add-on IRSA roles (`07-eks-addons` stack)

The ALB controller (above) and the External Secrets Operator (step 2) assume
scoped IAM roles via IRSA. The `07-eks-addons` stack creates both roles. There is
**no cluster autoscaler** on Fargate — Fargate right-sizes each pod and the HPA
scales replica count, so there is nothing to autoscale at the node level.

Deploy the stack once here; later steps read its exports.

```bash
OIDC_ID=$(aws eks describe-cluster \
  --name ridenow \
  --region ap-southeast-1 \
  --query "cluster.identity.oidc.issuer" \
  --output text --no-cli-pager | sed 's|.*/||')
echo "OIDC ID: $OIDC_ID"

aws cloudformation deploy \
  --stack-name ridenow-prod-eks-addons \
  --template-file iac/stacks/07-eks-addons.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=prod \
    EnableAddons=true \
    OidcProviderId=$OIDC_ID \
  --region ap-southeast-1 \
  --no-cli-pager
```

This exports `ridenow-prod-eks-AlbControllerRoleArn` and
`ridenow-prod-eks-ExternalSecretsRoleArn`, used by the ALB controller install
above and the ESO install in step 2.

---

## 2. Namespace and database Secrets

1. Create the namespace:

   ```bash
   kubectl apply -f iac/k8s/00-namespace.yaml   # creates namespace "ridenow"
   ```

2. Get each service's DB credentials into the cluster. Use the **External Secrets
   Operator** so Kubernetes Secrets are synced from Secrets Manager and rotate
   automatically — no credential ever sits in a manifest or in git. (A manual
   `kubectl create secret generic ...` works as a one-off break-glass fallback,
   but it does not rotate and is not the production path.)

   **External Secrets Operator** — what `iac/k8s/10-external-secrets.yaml`
   expects.

   **B1. Confirm the `07-eks-addons` stack is deployed** — it was run in step 1c
   and already created the ESO IRSA role. Retrieve its ARN and grant it KMS
   decrypt access on the RDS key. RDS-managed secrets are encrypted with the
   stack's KMS key; without this grant the operator gets `Access to KMS is not
   allowed` even after the Secrets Manager policy is correct.

   ```bash
   ESO_ROLE_ARN=$(aws cloudformation list-exports \
     --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-prod-eks-ExternalSecretsRoleArn'].Value" \
     --output text --no-cli-pager)
   echo "ESO Role ARN: $ESO_ROLE_ARN"

   KMS_KEY_ARN=$(aws kms describe-key \
     --key-id alias/ridenow-prod-rds \
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
     --query "Exports[?starts_with(Name,'ridenow-prod-data-') && ends_with(Name,'SecretArn')].{Name:Name,Value:Value}" \
     --output table --no-cli-pager
   # +------------------------------------+----------------------------------------------------------+
   # | ridenow-prod-data-UserDbSecretArn   | arn:aws:secretsmanager:...:secret:ridenow-prod-user-db-Xx |
   # | ridenow-prod-data-DriverDbSecretArn | arn:aws:secretsmanager:...:secret:ridenow-prod-driver-db-Xx|
   # | ridenow-prod-data-TripDbSecretArn   | arn:aws:secretsmanager:...:secret:ridenow-prod-trip-db-Xx  |
   # | ridenow-prod-data-PaymentDbSecretArn| arn:aws:secretsmanager:...:secret:ridenow-prod-payment-db-Xx|
   ```

   Then substitute all placeholders and apply:

   ```bash
   USER_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-prod-data-UserDbSecretArn'].Value" \
     --output text --no-cli-pager)
   DRIVER_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-prod-data-DriverDbSecretArn'].Value" \
     --output text --no-cli-pager)
   TRIP_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-prod-data-TripDbSecretArn'].Value" \
     --output text --no-cli-pager)
   PAYMENT_ARN=$(aws cloudformation list-exports --region ap-southeast-1 \
     --query "Exports[?Name=='ridenow-prod-data-PaymentDbSecretArn'].Value" \
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
       --key-id alias/ridenow-prod-rds \
       --region ap-southeast-1 \
       --query KeyMetadata.Arn \
       --output text --no-cli-pager)

     ESO_ROLE_ARN=$(aws cloudformation list-exports \
       --region ap-southeast-1 \
       --query "Exports[?Name=='ridenow-prod-eks-ExternalSecretsRoleArn'].Value" \
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

## 2.5. Per-pod security groups

Each service pod gets its own security group so it can only reach its own
database — a driver-service pod is physically blocked from reaching the user
database at the network level. On Fargate this is **native**: every Fargate pod
already runs on its own ENI, and a `SecurityGroupPolicy` binds specific SGs to
pods by label. There is **no `ENABLE_POD_ENI` step** — that flag is for the EC2
VPC CNI DaemonSet, which doesn't exist on Fargate.

By default Fargate pods attach to the **cluster security group**, which the DB SG
already trusts (guide 02 wires `DbIngressFromCluster`). The per-pod SGs below
tighten that from "any pod can reach any DB" to "each service reaches only its
own DB".

**1. Create one SG per service and wire it to that service's DB only:**

```bash
VPC_ID=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-prod-network-VpcId'].Value" \
  --output text --no-cli-pager)

DB_SG=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-prod-network-DbSecurityGroupId'].Value" \
  --output text --no-cli-pager)
echo "DB SG: $DB_SG"

for SVC in user driver trip payment; do
  SG_ID=$(aws ec2 create-security-group \
    --group-name ridenow-prod-${SVC}-service-sg \
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

**2. Create `iac/k8s/40-security-group-policies.yaml`** replacing each
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

**3. Apply the policy before deploying the services:**

```bash
kubectl apply -f iac/k8s/40-security-group-policies.yaml
```

Policies must exist before pods start — on Fargate the SG is attached to the pod
ENI at schedule time, so a pod that launched before the policy existed keeps the
default cluster SG until it is recreated.

Once the per-pod SGs are in place and confirmed working, tighten the DB SG by
removing the broad cluster-SG rule so only the per-service SGs remain:

```bash
CLUSTER_SG=$(aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-prod-network-NodeSecurityGroupId'].Value" \
  --output text --no-cli-pager)

aws ec2 revoke-security-group-ingress \
  --group-id $DB_SG \
  --protocol tcp \
  --port 5432 \
  --source-group $CLUSTER_SG \
  --region ap-southeast-1 \
  --no-cli-pager
```

---

## 3. Fill placeholders and deploy the services

The Deployment manifests in `iac/k8s/` carry placeholders. Replace them with your
real values (a quick `sed`, or edit by hand):

- `<ACCOUNT_ID>` -> your 12-digit account id
- `<REGION>` -> `ap-southeast-1`
- `<IMAGE_TAG>` -> the tag you pushed in guide 03 (e.g. `v1.0.0`)
- `<USER_DB_ENDPOINT>`, `<DRIVER_DB_ENDPOINT>`, ... -> the RDS endpoints (guide 04)

**What each manifest already ships — no extra work needed:**

- **`replicas: 2`** — two pods per service across AZs, so losing one pod (or the
  Fargate micro-VM under it) doesn't cause downtime.
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
  On Fargate the pod's requests determine the micro-VM size (rounded up to the
  nearest valid vCPU/memory combo) — here 250m / 512Mi bills as a 0.25 vCPU /
  0.5 GB task. You pay for the rounded-up size, so keep requests realistic.
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
  The HPA needs `metrics-server` (a Deployment on Fargate, installed as a cluster
  add-on in guide 05) to read pod CPU. Each new replica is a new Fargate pod.

Example with sed for one file:

```bash
sed -e 's/<ACCOUNT_ID>/123456789012/' \
    -e 's/<REGION>/ap-southeast-1/' \
    -e 's/<IMAGE_TAG>/v1.0.0/' \
    -e 's/<DRIVER_DB_ENDPOINT>/ridenow-prod-driver-db.abcd.ap-southeast-1.rds.amazonaws.com/' \
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

A JSON response through the ALB means: image pulled from ECR, pod healthy on
Fargate, connected to its RDS, reachable via the load balancer. That's the
backend running on EKS Fargate - **done**.

---

## Production hardening checklist

What this guide already sets up, and what to layer on next:

| Concern | Already in place | Hardening to add |
|---|---|---|
| Availability | `replicas: 2` per service across AZs | Add a `PodDisruptionBudget` (`maxUnavailable: 1`) so voluntary disruptions don't take a service fully down |
| Autoscaling | HPA on CPU 70 %, min 2 / max 6 (each replica a Fargate pod) | Tune thresholds per service; consider memory or custom metrics for I/O-heavy services |
| Compute | Fargate (no nodes to patch, size, or autoscale) | Nothing to do — this is the serverless-compute end state |
| Secrets | ESO syncs from Secrets Manager; per-pod SGs isolate each DB | Enable RDS managed password rotation; ESO picks up the new value automatically |
| IAM | IRSA per service account; Fargate pod execution role | Audit and scope each role to the minimum set of actions and resources |
| Network isolation | Per-pod SGs via `SecurityGroupPolicy` (step 2.5) — each service reaches only its own DB | Add NetworkPolicies for east-west pod traffic |
| TLS | Plain HTTP through ALB | Attach an ACM certificate to the ALB listener; add WAF for public endpoints |
| Image tags | `v1.0.0` pushed to ECR | Use immutable SHA digests (`image@sha256:...`) in CI/CD to prevent tag mutation |
| Observability | AMP scraper + Fargate log router (guide 06a) | Set log retention policies; add alarms on 5xx rates and pod restart counts |

The three highest-value items to tackle first are PodDisruptionBudgets, TLS on the
ALB, and locking image tags to digests — the rest can follow incrementally.

---

## Clean up

- `kubectl delete -f iac/k8s/30-ingress.yaml` first (this removes the ALB - it
  bills hourly), then the service manifests and namespace.
- Then tear down the cluster + Fargate profiles (guide 05) and RDS (guide 04).

Next (features provisioned in): `07-later-elasticache-redis.md`,
`08-later-sqs-eventbridge.md`.
