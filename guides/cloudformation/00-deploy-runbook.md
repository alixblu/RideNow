# 00 - Deploy runbook: RideNow production on EKS Fargate, in order

This is the top-level checklist that stitches the resource guides (`01-iam.md` to
`08-frontend.md`) and the in-cluster steps into one dependency-correct sequence. The
guides create the AWS **infrastructure** by hand in the Service_Consoles, not the
**running application**. A handful of image-build, Helm, and `kubectl` steps sit
between "resources created" and "`GET /api/drivers` works".

Everything is `prod`. Region is `ap-southeast-1` throughout (substitute your own
consistently). Run every command from the repo root.

> **Why an explicit order?** Later guides use values from earlier ones, and the
> in-cluster add-ons depend on IAM roles that only exist after the cluster. Two
> ordering traps this runbook avoids: guide **07 must come after 06** (it needs the
> cluster's OIDC id), and the ALB-controller / External-Secrets Helm installs must
> run **after 07** (they use the IRSA roles 07 creates).

---

## Phase 0 - Prerequisites (once)

- AWS CLI v2 configured as a non-root admin: `aws sts get-caller-identity` works.
  (Guide `01-iam.md` creates the two EKS roles and the policies in the IAM Console.)
- `docker`, `kubectl`, `helm`, and `jq` installed.
- Pick the region and keep it consistent.

---

## Discovery_Block - load every non-fixed value from AWS

Paste this once per terminal, from the repo root, after each guide that creates a
resource and before any step that needs its value. It only reads: every AWS call is
a `describe-*`, `list-*` or `get-*` call, found by the resource's Fixed_Name or tag.
It never calls any CloudFormation API. It has no `set -e` and sends errors to
`/dev/null`, so a resource you have not created yet leaves its variable empty and
the rest of the block still runs.

```bash
# ---- static values ----
export ENV=prod
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
export AWS_REGION="$AWS_DEFAULT_REGION"
export AWS_PAGER=""
export CLUSTER_NAME=ridenow-prod
export IMAGE_TAG="${IMAGE_TAG:-v1.0.0}"          # override: IMAGE_TAG=v1.0.1 before pasting
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)

# ---- helpers (read-only) ----
# param <layer> <key>: value from iac/params/prod.json, or empty if absent.
param() { jq -r --arg l "$1" --arg k "$2" '.[$l][$k] // empty' iac/params/prod.json 2>/dev/null; }
nn()    { grep -v -e '^None$' -e '^null$'; }       # turn "None" into empty
MISSING_LIST=""
show() {  # show <VAR> <Fixed_Name> <guide>: print the value, or MISSING
  local val="${!1}"
  if [ -n "$val" ]; then echo "$1=$val"
  else echo "MISSING: $2 (created by $3)"; MISSING_LIST="$MISSING_LIST $1"; fi
}
sgid() {  # sgid <Name tag>: security group id in the VPC
  aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=$1" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | nn
}
subnets() {  # subnets <Name tag> <Name tag>: comma-separated ids, in the order given
  local out="" id n
  for n in "$@"; do
    id=$(aws ec2 describe-subnets \
      --filters "Name=tag:Name,Values=$n" "Name=vpc-id,Values=$VPC_ID" \
      --query 'Subnets[0].SubnetId' --output text 2>/dev/null | nn)
    [ -n "$id" ] && out="${out:+$out,}$id"
  done
  echo "$out"
}
queue() {  # queue <name>: sets QUEUE_URL and QUEUE_ARN
  QUEUE_URL=$(aws sqs get-queue-url --queue-name "$1" --query QueueUrl --output text 2>/dev/null | nn)
  QUEUE_ARN=""
  [ -n "$QUEUE_URL" ] && QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text 2>/dev/null | nn)
}
rolearn() {  # rolearn <role name>
  aws iam get-role --role-name "$1" --query Role.Arn --output text 2>/dev/null | nn
}

# ---- network (02-network.md) ----
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=ridenow-$ENV-vpc" \
  --query 'Vpcs[0].VpcId' --output text 2>/dev/null | nn)
PUBLIC_SUBNET_IDS=$(subnets ridenow-$ENV-public-1 ridenow-$ENV-public-2)
PRIVATE_SUBNET_IDS=$(subnets ridenow-$ENV-private-1 ridenow-$ENV-private-2)
NODE_SG_ID=$(sgid ridenow-$ENV-cluster-sg)
DB_SG_ID=$(sgid ridenow-$ENV-db-sg)

# ---- data (04-data.md): six endpoints and six secret ARNs ----
for SVC in user driver trip payment matching notification; do
  U=$(echo "$SVC" | tr a-z A-Z)
  DB=ridenow-$ENV-$SVC-db
  EP=$(aws rds describe-db-instances --db-instance-identifier "$DB" \
    --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null | nn)
  SEC=$(aws rds describe-db-instances --db-instance-identifier "$DB" \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text 2>/dev/null | nn)
  [ -z "$SEC" ] && SEC=$(aws secretsmanager list-secrets \
    --query "SecretList[?Tags[?Key=='aws:rds:primaryDBInstanceArn' && ends_with(Value,':db:$DB')]].ARN | [0]" \
    --output text 2>/dev/null | nn)
  printf -v "${U}_DB_ENDPOINT" '%s' "$EP"
  printf -v "${U}_DB_SECRET_ARN" '%s' "$SEC"
done

# ---- messaging (05-messaging.md) ----
REDIS_ENDPOINT=$(aws elasticache describe-replication-groups \
  --replication-group-id ridenow-$ENV-redis \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text 2>/dev/null | nn)
REDIS_SG_ID=$(sgid ridenow-$ENV-redis-sg)
TRIP_EVENTS_TOPIC_ARN=$(aws sns list-topics \
  --query "Topics[?ends_with(TopicArn,':ridenow-$ENV-events')].TopicArn | [0]" --output text 2>/dev/null | nn)
queue ridenow-$ENV-matching;      MATCHING_QUEUE_URL=$QUEUE_URL;      MATCHING_QUEUE_ARN=$QUEUE_ARN
queue ridenow-$ENV-payment;       PAYMENT_QUEUE_URL=$QUEUE_URL;       PAYMENT_QUEUE_ARN=$QUEUE_ARN
queue ridenow-$ENV-notifications; NOTIFICATIONS_QUEUE_URL=$QUEUE_URL; NOTIFICATIONS_QUEUE_ARN=$QUEUE_ARN

# ---- EKS (06-eks-cluster.md) ----
EKS_ENDPOINT=$(aws eks describe-cluster --name "$CLUSTER_NAME" \
  --query cluster.endpoint --output text 2>/dev/null | nn)
OIDC_ISSUER_URL=$(aws eks describe-cluster --name "$CLUSTER_NAME" \
  --query cluster.identity.oidc.issuer --output text 2>/dev/null | nn)
OIDC_ID="${OIDC_ISSUER_URL##*/}"
EKS_CLUSTER_SG_ID=$(aws eks describe-cluster --name "$CLUSTER_NAME" \
  --query cluster.resourcesVpcConfig.clusterSecurityGroupId --output text 2>/dev/null | nn)

# ---- IAM roles (01-iam.md, 07-eks-addons.md, 08-frontend.md) ----
CLUSTER_ROLE_ARN=$(rolearn ridenow-$ENV-eks-cluster-role)
FARGATE_POD_ROLE_ARN=$(rolearn ridenow-$ENV-eks-fargate-pod-execution-role)
ALB_CONTROLLER_ROLE_ARN=$(rolearn ridenow-$ENV-alb-controller)
EXTERNAL_SECRETS_ROLE_ARN=$(rolearn ridenow-$ENV-external-secrets)
TRIP_SERVICE_ROLE_ARN=$(rolearn ridenow-$ENV-trip-service)
PAYMENT_SERVICE_ROLE_ARN=$(rolearn ridenow-$ENV-payment-service)
MATCHING_SERVICE_ROLE_ARN=$(rolearn ridenow-$ENV-matching-service)
NOTIFICATION_WORKER_ROLE_ARN=$(rolearn ridenow-$ENV-notification-worker)
DEPLOY_ROLE_ARN=$(rolearn ridenow-$ENV-frontend-deploy)   # optional: only if you created it

# ---- ALB created by the Ingress (Phase 6.2): found by the controller's cluster tag ----
ALB_DNS_NAME=""
for ARN in $(aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?VpcId=='$VPC_ID'].LoadBalancerArn" --output text 2>/dev/null | nn); do
  HIT=$(aws elbv2 describe-tags --resource-arns "$ARN" \
    --query "TagDescriptions[0].Tags[?Key=='elbv2.k8s.aws/cluster' && Value=='$CLUSTER_NAME'] | [0].Key" \
    --output text 2>/dev/null | nn)
  if [ -n "$HIT" ]; then
    ALB_DNS_NAME=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ARN" \
      --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null | nn)
    break
  fi
done

# ---- frontend (08-frontend.md) ----
read -r CLOUDFRONT_ID CLOUDFRONT_DOMAIN < <(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='RideNow $ENV frontend'].[Id,DomainName] | [0]" \
  --output text 2>/dev/null | nn)

# ---- values from iac/params/prod.json (not resource attributes) ----
DB_INSTANCE_CLASS=$(param 04-data DbInstanceClass)
REDIS_NODE_TYPE=$(param 05-messaging RedisNodeType)
KUBERNETES_VERSION=$(param 06-eks-cluster KubernetesVersion)
GITHUB_REPO=$(param 08-frontend GithubRepo)

# ---- summary ----
echo "ENV=$ENV  REGION=$AWS_DEFAULT_REGION  CLUSTER_NAME=$CLUSTER_NAME  IMAGE_TAG=$IMAGE_TAG"
show ACCOUNT_ID "AWS account (sts get-caller-identity)" "your AWS credentials"
show VPC_ID "ridenow-$ENV-vpc" 02-network.md
show PUBLIC_SUBNET_IDS "ridenow-$ENV-public-1, ridenow-$ENV-public-2" 02-network.md
show PRIVATE_SUBNET_IDS "ridenow-$ENV-private-1, ridenow-$ENV-private-2" 02-network.md
show NODE_SG_ID "ridenow-$ENV-cluster-sg" 02-network.md
show DB_SG_ID "ridenow-$ENV-db-sg" 02-network.md
for SVC in user driver trip payment matching notification; do
  U=$(echo "$SVC" | tr a-z A-Z)
  EPV="${U}_DB_ENDPOINT"; SCV="${U}_DB_SECRET_ARN"
  show "$EPV" "ridenow-$ENV-$SVC-db (endpoint)" 04-data.md
  show "$SCV" "ridenow-$ENV-$SVC-db (master secret)" 04-data.md
done
show REDIS_ENDPOINT "ridenow-$ENV-redis" 05-messaging.md
show REDIS_SG_ID "ridenow-$ENV-redis-sg" 05-messaging.md
show TRIP_EVENTS_TOPIC_ARN "ridenow-$ENV-events" 05-messaging.md
show MATCHING_QUEUE_URL "ridenow-$ENV-matching" 05-messaging.md
show MATCHING_QUEUE_ARN "ridenow-$ENV-matching" 05-messaging.md
show PAYMENT_QUEUE_URL "ridenow-$ENV-payment" 05-messaging.md
show PAYMENT_QUEUE_ARN "ridenow-$ENV-payment" 05-messaging.md
show NOTIFICATIONS_QUEUE_URL "ridenow-$ENV-notifications" 05-messaging.md
show NOTIFICATIONS_QUEUE_ARN "ridenow-$ENV-notifications" 05-messaging.md
show EKS_ENDPOINT "$CLUSTER_NAME" 06-eks-cluster.md
show OIDC_ISSUER_URL "$CLUSTER_NAME (OIDC issuer)" 06-eks-cluster.md
show OIDC_ID "$CLUSTER_NAME (OIDC id)" 06-eks-cluster.md
show EKS_CLUSTER_SG_ID "$CLUSTER_NAME (cluster security group)" 06-eks-cluster.md
show CLUSTER_ROLE_ARN "ridenow-$ENV-eks-cluster-role" 01-iam.md
show FARGATE_POD_ROLE_ARN "ridenow-$ENV-eks-fargate-pod-execution-role" 01-iam.md
show ALB_CONTROLLER_ROLE_ARN "ridenow-$ENV-alb-controller" 07-eks-addons.md
show EXTERNAL_SECRETS_ROLE_ARN "ridenow-$ENV-external-secrets" 07-eks-addons.md
show TRIP_SERVICE_ROLE_ARN "ridenow-$ENV-trip-service" 07-eks-addons.md
show PAYMENT_SERVICE_ROLE_ARN "ridenow-$ENV-payment-service" 07-eks-addons.md
show MATCHING_SERVICE_ROLE_ARN "ridenow-$ENV-matching-service" 07-eks-addons.md
show NOTIFICATION_WORKER_ROLE_ARN "ridenow-$ENV-notification-worker" 07-eks-addons.md
show DEPLOY_ROLE_ARN "ridenow-$ENV-frontend-deploy" 08-frontend.md
show ALB_DNS_NAME "ALB tagged elbv2.k8s.aws/cluster=$CLUSTER_NAME" "30-ingress.yaml (Phase 6.2)"
show CLOUDFRONT_ID "CloudFront distribution 'RideNow $ENV frontend'" 08-frontend.md
show CLOUDFRONT_DOMAIN "CloudFront distribution 'RideNow $ENV frontend'" 08-frontend.md
show DB_INSTANCE_CLASS "04-data.DbInstanceClass in prod.json" "iac/params/prod.json"
show REDIS_NODE_TYPE "05-messaging.RedisNodeType in prod.json" "iac/params/prod.json"
show KUBERNETES_VERSION "06-eks-cluster.KubernetesVersion in prod.json" "iac/params/prod.json"
show GITHUB_REPO "08-frontend.GithubRepo in prod.json" "iac/params/prod.json"
```

**Expected output.** One `NAME=value` line per variable, after a header line
`ENV=prod  REGION=ap-southeast-1  CLUSTER_NAME=ridenow-prod  IMAGE_TAG=v1.0.0`. For
every resource you have not created yet, the block prints
`MISSING: <Fixed_Name> (created by <NN>-<guide>.md)` instead, and keeps going. Before
you start, only `ACCOUNT_ID` and the four `prod.json` values resolve and everything
else is `MISSING`. After guide 08, nothing is `MISSING` except
`ALB_DNS_NAME` before the Ingress exists and `DEPLOY_ROLE_ARN` if you skipped the
optional deploy role. Re-paste the block after each guide to refresh it.

---

## Phase 1 - Infrastructure (Service_Console, guides 01 -> 07)

Every AWS resource is created by hand in its Service_Console, one guide at a time.
Each guide lists the exact console fields and ends with a Verify section. After each
guide, re-paste the [Discovery_Block](#discovery_block---load-every-non-fixed-value-from-aws)
and check that the variables the guide creates are no longer `MISSING`.

| Order | Guide | Creates | Needs first |
|-------|-------|---------|-------------|
| 1 | [01-iam.md](01-iam.md) | Cluster role, Fargate pod execution role, app-access policy, one messaging policy per service | nothing |
| 2 | [02-network.md](02-network.md) | 2-AZ VPC, NAT gateway per AZ, cluster SG, DB SG | nothing |
| 3 | [03-ecr.md](03-ecr.md) | One ECR repository per service | nothing (images come in Phase 2) |
| 4 | [04-data.md](04-data.md) | KMS key, DB subnet group, 6 RDS instances (user, driver, trip, payment, matching, notification) and their Secrets Manager secrets | 02 |
| 5 | [05-messaging.md](05-messaging.md) | SNS topic, matching / payment / notifications queues + DLQs, filtered subscriptions, ElastiCache for Valkey | 02 |
| 6 | [06-eks-cluster.md](06-eks-cluster.md) | EKS control plane and 3 Fargate profiles (no node group) | 01, 02 |
| 7 | [07-eks-addons.md](07-eks-addons.md) | SG rules for the pods, OIDC provider, IRSA roles (ALB controller, External Secrets, trip, payment, matching, notification-worker) | 01, 06 |

Guides 04 and 05 can be created in parallel with 03 once 02 exists. The slow
resources are the 2 NAT gateways (3-5 min), the 6 RDS instances (10-20 min), the
Valkey replication group (10-15 min) and the EKS cluster with its Fargate profiles
(10-15 min). Start the RDS and Valkey creations first and work on other guides while
they run.

Guide 07 must come after 06 (it needs the cluster's OIDC id), and the ALB controller
and External Secrets installs in Phase 4 must come after 07 (they use its IRSA roles).
`realtime-gateway` has no database.

When guide 07 is done you have the full AWS footprint but an **empty cluster** (only
the control plane and the Fargate profiles). Point `kubectl` at it:

```bash
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"
kubectl get svc kubernetes    # confirms you're connected
```

---

## Phase 2 - Build and push images

The ECR repositories exist ([03-ecr.md](03-ecr.md)) but are empty. Build and push
before deploying any service manifest, or pods will `ImagePullBackOff`. Use the
`ACCOUNT_ID`, `AWS_REGION` and `IMAGE_TAG` values from the Discovery_Block.

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  docker buildx build --platform linux/amd64 \
    -t "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/ridenow/$SVC:$IMAGE_TAG" \
    --push "$SVC/"
done
```

Verify each repository has the `$IMAGE_TAG` tag:

```bash
for SVC in user-service driver-service trip-service payment-service matching-service notification-worker realtime-gateway; do
  echo -n "$SVC: "; aws ecr describe-images --repository-name "ridenow/$SVC" --image-ids "imageTag=$IMAGE_TAG" --query 'imageDetails[0].imageTags' --output text
done
```

---

## Phase 3 - Make the cluster usable

Fargate has no nodes. CoreDNS pods stay `Pending` ("no nodes available") in two
cases, and both are fixed by recreating them once the `kube-system` Fargate profile
is **Active**:

- the CoreDNS template still carries the annotation that pins it to EC2 (remove it);
- the pods were created before the Fargate profile existed (the cluster is created
  first and the profiles one at a time). A pod is matched to a profile only when it
  is created, so these pods never move to Fargate on their own. The annotation can
  already be gone in this case, and the restart alone is the fix.

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

Guide 07 registers the cluster's OIDC provider in IAM (the IRSA roles trust it), so
there is nothing to enable here. To confirm it exists:

```bash
aws iam list-open-id-connect-providers --output text | grep "$OIDC_ID" \
  && echo "OIDC provider present" || echo "missing: create it in 07-eks-addons.md"
```

If it is missing, create it in the IAM Console as described in
[07-eks-addons.md](07-eks-addons.md). Do not create it with `eksctl`: a provider
that already exists makes the console step fail with `EntityAlreadyExists`.

---

## Phase 4 - In-cluster add-ons (Helm)

Needs the IRSA roles from [07-eks-addons.md](07-eks-addons.md). Re-paste the
[Discovery_Block](#discovery_block---load-every-non-fixed-value-from-aws) first and
check that `ALB_CONTROLLER_ROLE_ARN`, `EXTERNAL_SECRETS_ROLE_ARN` and `VPC_ID` are not
`MISSING`. Order matters.

### 4.1 AWS Load Balancer Controller

Install the controller with Helm, using the role ARN and VPC id from the Discovery_Block:

```bash
helm repo add eks https://aws.github.io/eks-charts && helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName="$CLUSTER_NAME" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$ALB_CONTROLLER_ROLE_ARN" \
  --set region="$AWS_REGION" \
  --set vpcId="$VPC_ID"
```

The controller has no permissions yet. Without them the Ingress gets no address and
the controller logs `AccessDenied ... elasticloadbalancing:DescribeLoadBalancers`.
The permissions policy depends on the controller version, so download the one that
matches the version Helm installed:

```bash
mkdir -p .tmp
CONTROLLER_VERSION=$(helm list -n kube-system -o json \
  | jq -r '.[] | select(.name=="aws-load-balancer-controller") | .app_version')
echo "controller version: $CONTROLLER_VERSION"
curl -fsSL -o .tmp/alb-controller-iam-policy.json \
  "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${CONTROLLER_VERSION}/docs/install/iam_policy.json"
```

Create and attach the policy in the IAM Console:

1. IAM Console > **Policies** > **Create policy** > **JSON** tab. Paste the contents
   of `.tmp/alb-controller-iam-policy.json`. Name it `AWSLoadBalancerControllerIAMPolicy`.
   If it already exists from an earlier cluster, reuse it.
2. IAM Console > **Roles** > `ridenow-prod-alb-controller` > **Add permissions** >
   **Attach policies** > select `AWSLoadBalancerControllerIAMPolicy`.

Then restart the controller so it picks the permissions up:

```bash
kubectl rollout restart deployment aws-load-balancer-controller -n kube-system
kubectl rollout status  deployment aws-load-balancer-controller -n kube-system --timeout=300s
kubectl get deploy -n kube-system aws-load-balancer-controller   # expect 1/1
```

### 4.2 External Secrets Operator

External Secrets must decrypt the RDS secrets with the KMS key from
[04-data.md](04-data.md) (alias `alias/ridenow-prod-rds`). Write the permission
document, then add it to the role in the IAM Console:

```bash
RDS_KMS_KEY_ARN=$(aws kms describe-key --key-id alias/ridenow-prod-rds \
  --query KeyMetadata.Arn --output text)
mkdir -p .tmp
cat > .tmp/external-secrets-kms-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:DescribeKey"],
      "Resource": "$RDS_KMS_KEY_ARN"
    }
  ]
}
EOF
cat .tmp/external-secrets-kms-policy.json
```

IAM Console > **Roles** > `ridenow-prod-external-secrets` > **Add permissions** >
**Create inline policy** > **JSON** tab. Paste the document above and name it
`ridenow-prod-external-secrets-kms`. Skip this if the inline policy already exists.

```bash
helm repo add external-secrets https://charts.external-secrets.io && helm repo update

# webhook.port=9443 is required on Fargate (the default 10250 clashes with the kubelet)
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$EXTERNAL_SECRETS_ROLE_ARN" \
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

Each service gets its own security group, allowed only to its own database. Create
the six groups and their database rules in the EC2 Console, then give them to the
pods with a `SecurityGroupPolicy`.

EC2 Console > **Security Groups** > **Create security group**, once per service:

| Name | Description | VPC | Inbound | Outbound |
|------|-------------|-----|---------|----------|
| `ridenow-prod-user-service-sg` | `user-service pods` | `ridenow-prod-vpc` | none | default (all traffic) |
| `ridenow-prod-driver-service-sg` | `driver-service pods` | `ridenow-prod-vpc` | none | default |
| `ridenow-prod-trip-service-sg` | `trip-service pods` | `ridenow-prod-vpc` | none | default |
| `ridenow-prod-payment-service-sg` | `payment-service pods` | `ridenow-prod-vpc` | none | default |
| `ridenow-prod-matching-service-sg` | `matching-service pods` | `ridenow-prod-vpc` | none | default |
| `ridenow-prod-notification-service-sg` | `notification-service pods` | `ridenow-prod-vpc` | none | default |

Then EC2 Console > **Security Groups** > `ridenow-prod-db-sg` > **Inbound rules** >
**Edit inbound rules** > add six rules: type `PostgreSQL`, port `5432`, source = each
of the six groups above. Safe to repeat: skip a rule that already exists.

Now read the six ids and apply the policies. `EKS_CLUSTER_SG_ID` stays on every pod
because DNS and Redis need it:

```bash
: > .tmp/sgp.yaml
for SVC in user driver trip payment matching notification; do
  SG_ID=$(sgid ridenow-$ENV-$SVC-service-sg)
  if [ -z "$SG_ID" ]; then echo "MISSING: ridenow-$ENV-$SVC-service-sg (create it in the EC2 Console)"; continue; fi
  APP=${SVC}-service; [ $SVC = notification ] && APP=notification-worker
  cat >> .tmp/sgp.yaml <<EOF
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
      - ${EKS_CLUSTER_SG_ID}
EOF
  echo "$APP -> $SG_ID"
done

kubectl apply -f .tmp/sgp.yaml
kubectl rollout restart deploy -n ridenow     # pods started earlier keep the old SG until restarted
kubectl get securitygrouppolicy -n ridenow     # expect 6
```

The `sgid` helper is defined in the Discovery_Block.

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
sed -e "s|<REGION>|$AWS_REGION|g" \
    -e "s|<ENV>|$ENV|g" \
    -e "s|<USER_SECRET_ARN>|$USER_DB_SECRET_ARN|g" \
    -e "s|<DRIVER_SECRET_ARN>|$DRIVER_DB_SECRET_ARN|g" \
    -e "s|<TRIP_SECRET_ARN>|$TRIP_DB_SECRET_ARN|g" \
    -e "s|<PAYMENT_SECRET_ARN>|$PAYMENT_DB_SECRET_ARN|g" \
    -e "s|<MATCHING_SECRET_ARN>|$MATCHING_DB_SECRET_ARN|g" \
    -e "s|<NOTIFICATION_SECRET_ARN>|$NOTIFICATION_DB_SECRET_ARN|g" \
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

Set the value that is not an AWS resource. `APP_ORIGIN` is the browser origin of the
app (never `*`). Everything else comes from the Discovery_Block.

```bash
APP_ORIGIN=https://app.example.com
```

Fill in every placeholder and apply. Payment goes first, because trip-service
calls it when a trip is created.

```bash
deploy() {
  sed -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" \
      -e "s|<REGION>|$AWS_REGION|g" \
      -e "s|<ENV>|$ENV|g" \
      -e "s|<IMAGE_TAG>|$IMAGE_TAG|g" \
      -e "s|<APP_ORIGIN>|$APP_ORIGIN|g" \
      -e "s|<REDIS_ENDPOINT>|$REDIS_ENDPOINT|g" \
      -e "s|<USER_DB_ENDPOINT>|$USER_DB_ENDPOINT|g" \
      -e "s|<DRIVER_DB_ENDPOINT>|$DRIVER_DB_ENDPOINT|g" \
      -e "s|<TRIP_DB_ENDPOINT>|$TRIP_DB_ENDPOINT|g" \
      -e "s|<PAYMENT_DB_ENDPOINT>|$PAYMENT_DB_ENDPOINT|g" \
      -e "s|<MATCHING_DB_ENDPOINT>|$MATCHING_DB_ENDPOINT|g" \
      -e "s|<NOTIFICATION_DB_ENDPOINT>|$NOTIFICATION_DB_ENDPOINT|g" \
      -e "s|<MATCHING_QUEUE_URL>|$MATCHING_QUEUE_URL|g" \
      -e "s|<PAYMENT_QUEUE_URL>|$PAYMENT_QUEUE_URL|g" \
      -e "s|<NOTIFICATIONS_QUEUE_URL>|$NOTIFICATIONS_QUEUE_URL|g" \
      -e "s|<TRIP_SERVICE_ROLE_ARN>|$TRIP_SERVICE_ROLE_ARN|g" \
      -e "s|<PAYMENT_SERVICE_ROLE_ARN>|$PAYMENT_SERVICE_ROLE_ARN|g" \
      -e "s|<MATCHING_SERVICE_ROLE_ARN>|$MATCHING_SERVICE_ROLE_ARN|g" \
      -e "s|<NOTIFICATION_WORKER_ROLE_ARN>|$NOTIFICATION_WORKER_ROLE_ARN|g" \
      "iac/k8s/$1.yaml" | kubectl apply -f -
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

Re-paste the [Discovery_Block](#discovery_block---load-every-non-fixed-value-from-aws)
so `ALB_DNS_NAME` is set. It is also the value [08-frontend.md](08-frontend.md) uses
as the CloudFront API origin.

```bash
ADDR=$(kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "$ADDR"
echo "$ALB_DNS_NAME"      # same hostname, found through the ELB API
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
dashboards, alert rules, and failure simulations are outside this guide set.

---

## Quick order summary

```bash
# Phase 1: create the resources of 01-iam.md ... 07-eks-addons.md in the Service_Consoles
#   (re-paste the Discovery_Block after each guide)
# Phase 2: push images to ECR (needs 03-ecr.md)
# Phase 3: update-kubeconfig, patch CoreDNS
# Phase 4: Helm: ALB controller + its IAM policy, External Secrets (webhook.port=9443) + KMS permission (needs 07's roles)
# Phase 5: namespace, per-pod SGs, log router, ExternalSecrets
# Phase 6: service manifests 20-26, ingress 30
# Phase 7: Valkey + SQS env wiring (already in the manifests)
# Phase 8: observability (06a)
```

---

## Redeploy after the cluster is recreated

Use this when `kubectl` says `no such host`, or the ALB returns `503`. The new
cluster is empty, so you redeploy what runs inside it.

```bash
# 1. Point kubectl at the new cluster
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"

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

6. If the hostname changed, update the `A=` ALB hostname variable wherever you keep it for manual tests.

---

## Teardown

There is nothing to delete in one step. Delete each resource in its own
Service_Console, in reverse dependency order: a resource goes only after everything
that uses it is gone. The in-cluster cleanup **must** run first, because the ALB
created by the Ingress holds network interfaces in the subnets and blocks the VPC
deletion otherwise.

### T1. In the cluster (kubectl, Helm)

```bash
kubectl delete -f iac/k8s/30-ingress.yaml          # removes the ALB
for F in 26-realtime-gateway 25-notification-worker 24-matching-service \
         22-trip-service 21-driver-service 20-user-service 23-payment-service; do
  kubectl delete -f "iac/k8s/$F.yaml" --ignore-not-found
done
kubectl delete securitygrouppolicy --all -n ridenow --ignore-not-found
kubectl delete -f iac/k8s/10-external-secrets.yaml --ignore-not-found
kubectl delete namespace ridenow aws-observability --ignore-not-found
helm uninstall external-secrets -n external-secrets
helm uninstall aws-load-balancer-controller -n kube-system
kubectl delete namespace external-secrets --ignore-not-found
```

Wait until the ALB is gone. Re-paste the Discovery_Block: `ALB_DNS_NAME` must print
`MISSING`. Also check EC2 Console > **Load Balancers**: no load balancer tagged
`elbv2.k8s.aws/cluster = ridenow-prod` remains.

### T2. Delete in this order

| Step | Service_Console | Delete | Notes |
|------|-----------------|--------|-------|
| 1 | CloudFront > **Distributions** | The `RideNow prod frontend` distribution | **Disable** it, wait until **Last modified** shows a date, then **Delete**. Then **Functions**: delete the SPA rewrite function. **Origin access control**: delete `ridenow-prod-frontend-oac`. |
| 2 | S3 > **Buckets** | `ridenow-prod-frontend-<account id>-<region>` | **Empty** it (all versions), then **Delete**. |
| 3 | IAM > **Roles** | `ridenow-prod-frontend-deploy` (if you created it) | Detach or delete its inline policy first. |
| 4 | EC2 > **Security Groups** | The six `ridenow-prod-<service>-service-sg` groups | First remove the six rules from `ridenow-prod-db-sg` inbound rules, then delete the groups. |
| 5 | EC2 > **Security Groups** | The two pod-access inbound rules from [07-eks-addons.md](07-eks-addons.md) | On `ridenow-prod-db-sg` (5432) and `ridenow-prod-redis-sg` (6379), delete the rules whose source is the EKS cluster security group. |
| 6 | IAM > **Roles** | The six IRSA roles: `ridenow-prod-alb-controller`, `-external-secrets`, `-trip-service`, `-payment-service`, `-matching-service`, `-notification-worker` | Detach the policies first. |
| 7 | IAM > **Identity providers** | The OIDC provider of the cluster | Delete after step 6. |
| 8 | IAM > **Policies** | `AWSLoadBalancerControllerIAMPolicy` | Delete after it is detached from the role in step 6. |
| 9 | EKS > **Clusters** > `ridenow-prod` > **Compute** | The three Fargate profiles | Delete one at a time, in reverse order: observability, app, system. Wait for each to finish. |
| 10 | EKS > **Clusters** | `ridenow-prod` | Delete after the profiles are gone. |
| 11 | KMS > **Customer managed keys** | The cluster secrets key | **Schedule key deletion** (7 days minimum). |
| 12 | ElastiCache > **Valkey caches** | `ridenow-prod-redis` | Delete, then **Subnet groups**: the Valkey subnet group. Then EC2: delete `ridenow-prod-redis-sg`. |
| 13 | SNS > **Subscriptions**, **Topics** | The three subscriptions, then `ridenow-prod-events` | |
| 14 | SQS > **Queues** | `ridenow-prod-matching`, `-payment`, `-notifications` and their three DLQs | Delete queues before their DLQs. |
| 15 | RDS > **Databases** | The six `ridenow-prod-<service>-db` instances | Take a final snapshot when asked. Deletion protection is off. The master-user secrets in Secrets Manager are removed with the instances. |
| 16 | RDS > **Subnet groups** | The DB subnet group | After all six instances are gone. |
| 17 | KMS > **Customer managed keys** | The RDS key (`alias/ridenow-prod-rds`) | **Schedule key deletion**. |
| 18 | EC2 > **Security Groups** | `ridenow-prod-db-sg`, then `ridenow-prod-cluster-sg` | Delete after the RDS, Valkey and EKS resources that use them. |
| 19 | ECR > **Repositories** | The seven `ridenow/<service>` repositories | Delete with the images. |
| 20 | VPC > **NAT gateways** | Both NAT gateways | Wait for **Deleted**, then VPC > **Elastic IPs**: **Release** both. |
| 21 | VPC > **Route tables**, **Subnets**, **Internet gateways**, **Your VPCs** | Route tables, four subnets, the internet gateway (**Detach** then delete), then `ridenow-prod-vpc` | In this order. |
| 22 | IAM > **Roles**, **Policies** | The two EKS roles, then the app-access policy and the four messaging policies | Last: guide 01 resources have no dependents left. |
| 23 | CloudWatch > **Log groups** | `/aws/eks/ridenow/fargate` and the cluster log group | Optional. |

After step 22, re-paste the [Discovery_Block](#discovery_block---load-every-non-fixed-value-from-aws).
Every resource variable must print `MISSING`:

```bash
echo "Still present:"
for V in VPC_ID REDIS_ENDPOINT TRIP_EVENTS_TOPIC_ARN EKS_ENDPOINT CLUSTER_ROLE_ARN \
         USER_DB_ENDPOINT CLOUDFRONT_ID ALB_DNS_NAME; do
  [ -n "${!V}" ] && echo "  $V=${!V}"
done
```

An empty list means nothing is left to pay for. If a deletion is refused with a
dependency message, the Service_Console names the resource that still uses it. Delete
that one first.
