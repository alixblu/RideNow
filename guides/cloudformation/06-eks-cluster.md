# 06 - EKS cluster (control plane and Fargate profiles)

Creates a KMS key, the EKS cluster `ridenow-prod` and three Fargate profiles of `iac/stacks/06-eks-cluster.yaml` (`Environment=prod`, `KubernetesVersion=1.31`, from `iac/params/prod.json`) in region `ap-southeast-1`.

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `ClusterKmsKey` | KMS key | alias `ridenow-prod-eks-secrets`, description `ridenow-prod EKS secrets encryption key` |
| `Cluster` | EKS cluster | `ridenow-prod` (Kubernetes `1.31`) |
| `SystemFargateProfile` | EKS Fargate profile | `ridenow-prod-system` |
| `AppFargateProfile` | EKS Fargate profile | `ridenow-prod-app` |
| `ObservabilityFargateProfile` | EKS Fargate profile | `ridenow-prod-observability` |

## Depends on

Copy each value below from the console before you start. The first five are used in the Create steps. The rest are used in the Post-Deploy steps.

| Value | Created in | Where to find it in the console |
|---|---|---|
| Account ID (12 digits), used wherever this guide shows `<ACCOUNT_ID>` | Your AWS account | Top-right account menu, copy **Account ID** |
| Cluster role ARN | [01-iam.md](./01-iam.md) | **IAM -> Roles** -> `ridenow-prod-eks-cluster-role` -> copy **ARN** |
| Fargate pod execution role ARN | [01-iam.md](./01-iam.md) | **IAM -> Roles** -> `ridenow-prod-eks-fargate-pod-execution-role` -> copy **ARN** |
| Private subnets `ridenow-prod-private-1` and `ridenow-prod-private-2` | [02-network.md](./02-network.md) | **VPC -> Subnets**, search `ridenow-prod-private`, copy both **Subnet ID** values (`subnet-...`) |
| Cluster security group `ridenow-prod-cluster-sg` | [02-network.md](./02-network.md) | **VPC -> Security groups**, search `ridenow-prod-cluster-sg`, copy **Security group ID** (`sg-...`) |
| VPC `ridenow-prod-vpc` | [02-network.md](./02-network.md) | **VPC -> Your VPCs**, search `ridenow-prod-vpc`, copy **VPC ID** (`vpc-...`) |
| Database security group `ridenow-prod-db-sg` | [02-network.md](./02-network.md) | **VPC -> Security groups**, search `ridenow-prod-db-sg` (used in Post-Deploy step 6) |
| Six database secret ARNs (user, driver, trip, payment, matching, notification) | [04-data.md](./04-data.md) | **RDS -> Databases** -> `ridenow-prod-<service>-db` -> **Configuration** tab -> copy **Master Credentials ARN** |
| Load Balancer Controller role ARN | [07-eks-addons.md](./07-eks-addons.md) | **IAM -> Roles** -> `ridenow-prod-alb-controller` -> copy **ARN** |
| External Secrets role ARN | [07-eks-addons.md](./07-eks-addons.md) | **IAM -> Roles** -> `ridenow-prod-external-secrets` -> copy **ARN** |

The two roles from 07 do not exist until you create them (see "Before steps 3 and 4").
## Create the resources

Do the steps in order. Note: the console needs an alias for the key (the Template has none), and EKS allows only one Fargate profile creating at a time, so wait for **Active** between profiles.

### 1. KMS key (`ClusterKmsKey`)

**Create the key**

1. Set the console region to **Asia Pacific (Singapore) ap-southeast-1**.
2. Go to **KMS -> Customer managed keys -> Create key**.
3. Set **Key type** to `Symmetric`.
4. Set **Key usage** to `Encrypt and decrypt`.
5. Expand **Advanced options**. Set **Key material origin** to `KMS`.
6. Set **Regionality** to `Single-Region key`.
7. Select **Next**.

**Alias and description**

1. Set **Alias** to `ridenow-prod-eks-secrets`.
2. Set **Description** to `ridenow-prod EKS secrets encryption key`.
3. Select **Next**.

**Permissions**

1. On **Key administrators**, tick nothing. Select **Next**.
2. On **Key users**, tick nothing. Select **Next**.
3. On **Key policy**, delete the existing JSON.
4. Paste the JSON below. Replace `<ACCOUNT_ID>` with the **Account ID** from the table in **Depends on**.
5. Select **Next**.
6. Select **Review**, then **Finish**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT_ID>:root" },
      "Action": "kms:*",
      "Resource": "*"
    }
  ]
}
```

**Turn on rotation**

1. Open the key. Go to the **Key rotation** tab and select **Edit**.
2. Tick **Automatically rotate this KMS key every year**.
3. Select **Save**.

### 1a. Control-plane log group (`ClusterLogGroup`)

Create the log group before the cluster, so the cluster writes into a group that has a retention.

1. Go to **CloudWatch -> Logs -> Log management -> Create log group**.
2. Set **Log group name** to `/aws/eks/ridenow-prod/cluster`.
3. Set **Retention setting** to `2 weeks (14 days)`.
4. Leave **Log class** on `Standard`.
5. Select **Create**.

Note: if EKS already created a group with this name (an earlier cluster, or log types turned on before this step), delete it first. An auto-created group has **Never expire** retention and the template cannot create a group that already exists. Go to **CloudWatch -> Logs -> Log management**, tick `/aws/eks/ridenow-prod/cluster`, select **Actions -> Delete log group(s)**, then select **Delete**. This removes the old control-plane logs, so export anything you need first. Then do the numbered steps above.

### 2. EKS cluster (`Cluster`)

**Configure cluster**

1. Go to **EKS -> Clusters -> Create cluster**.
2. Set **Configuration options** to `Custom configuration`.
3. Turn **Use EKS Auto Mode** off.
4. Set **Name** to `ridenow-prod`.
5. Set **Cluster IAM role** to `ridenow-prod-eks-cluster-role`.
6. Set **Kubernetes version** to `1.31`.
7. Set **Upgrade policy** to `Standard`.
8. Leave **Bootstrap cluster administrator access** on `Allow cluster administrator access`.
9. Leave **Cluster authentication mode** on `EKS API and ConfigMap`.
10. Tick **Turn on envelope encryption of Kubernetes secrets using KMS**.
11. Set **KMS key** to the alias `ridenow-prod-eks-secrets`.
12. Select **Next**.

**Specify networking**

1. Set **VPC** to `ridenow-prod-vpc`.
2. In **Subnets**, untick every subnet except `ridenow-prod-private-1` and `ridenow-prod-private-2`.
3. Set **Security groups** to `ridenow-prod-cluster-sg`.
4. Set **Cluster IP address family** to `IPv4`.
5. Set **Cluster endpoint access** to `Public and private`.
6. Expand **Advanced settings**. Leave **Public access source allowlist** on `0.0.0.0/0`.
7. Select **Next**.

**Observability and add-ons**

1. On **Configure observability**, under **Control plane logs**, turn on all five log types: `API server`, `Audit`, `Authenticator`, `Controller manager` and `Scheduler`. Leave **Prometheus metrics** and **CloudWatch Observability agent** off. Select **Next**. The logs go to the group from step 1a.
2. On **Select add-ons**, leave `kube-proxy`, `CoreDNS` and `Amazon VPC CNI` ticked. Select **Next**.
3. On **Configure selected add-ons settings**, leave the defaults. Select **Next**.
4. Select **Create**.
5. Wait 10 to 15 minutes until **Status** is `Active`.

### 3. Fargate profile `ridenow-prod-system` (`SystemFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-system`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `kube-system`. Leave **Match labels** empty.
7. Select **Add selector**. Set **Namespace** to `external-secrets`. Leave **Match labels** empty.
8. Select **Next**.
9. Select **Create**.
10. Wait 1 to 2 minutes until **Status** is `Active`.

### 4. Fargate profile `ridenow-prod-app` (`AppFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-app`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `ridenow`. Leave **Match labels** empty.
7. Select **Next**.
8. Select **Create**.
9. Wait until **Status** is `Active`.

### 5. Fargate profile `ridenow-prod-observability` (`ObservabilityFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-observability`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `aws-observability`. Leave **Match labels** empty.
7. Select **Next**.
8. Select **Create**.
9. Wait until **Status** is `Active`.

## Values to record

Read these in **EKS -> Clusters -> `ridenow-prod`**.

| Output_Equivalent (Template output) | Value | Console location | Consumed by |
|---|---|---|---|
| `ClusterName` | `ridenow-prod` | **EKS -> Clusters**, **Name** column | Every later guide |
| `ClusterEndpoint` | API server endpoint | **Overview -> Details -> API server endpoint** | Connection checks in Post-Deploy |
| `OidcIssuerUrl` | `https://oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC id>` | **Overview -> Details -> OpenID Connect provider URL** | `07-eks-addons.md` (OIDC provider URL and the OIDC id) |
| `ClusterSecurityGroupId` | `sg-...` | **Networking** tab -> **Cluster security group** | `07-eks-addons.md` (source of the database 5432 and Redis 6379 rules) |
## Post-Deploy

Run these steps from the repo root, in order. Each step sets the variables it needs, using the values you copied in **Depends on**.

### 1. Kubeconfig

Write the cluster into your kubeconfig with the IAM identity that created it.

```bash
aws eks update-kubeconfig --name ridenow-prod --region ap-southeast-1
kubectl get svc kubernetes
```

Expected: `Updated context ...cluster/ridenow-prod`, then one `kubernetes   ClusterIP ... 443/TCP` row.

### 2. CoreDNS on Fargate

Fargate has no nodes. CoreDNS pods stay `Pending` ("no nodes available") in two cases. Both are fixed by recreating them once the `ridenow-prod-system` Fargate profile is **Active**:

- The CoreDNS template still carries the annotation that pins it to EC2. Remove it.
- The pods were created before the Fargate profile existed. A pod is matched to a profile only when it is created, so these pods never move to Fargate on their own. The annotation can already be gone in this case, and the restart alone is the fix.

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

Expected: `deployment "coredns" successfully rolled out`.

### Before steps 3 and 4

Steps 3 and 4 need the IRSA roles from [07-eks-addons.md](07-eks-addons.md), so create those roles first (up to the Verify of the IRSA roles). Then copy their two role ARNs as listed in **Depends on**. Do step 3 before step 4.

### 3. AWS Load Balancer Controller

Install the controller with Helm. Paste the two values from **Depends on** first:

```bash
ALB_CONTROLLER_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-alb-controller
VPC_ID=vpc-xxxxxxxx

helm repo add eks https://aws.github.io/eks-charts && helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=ridenow-prod \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$ALB_CONTROLLER_ROLE_ARN" \
  --set region=ap-southeast-1 \
  --set vpcId="$VPC_ID"
```

The controller has no permissions yet. Without them the Ingress gets no address and the controller logs `AccessDenied ... elasticloadbalancing:DescribeLoadBalancers`. The permissions policy depends on the controller version, so download the one that matches the version Helm installed:

```bash
mkdir -p .tmp
CONTROLLER_VERSION=$(helm list -n kube-system -o json \
  | jq -r '.[] | select(.name=="aws-load-balancer-controller") | .app_version')
echo "controller version: $CONTROLLER_VERSION"
curl -fsSL -o .tmp/alb-controller-iam-policy.json \
  "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${CONTROLLER_VERSION}/docs/install/iam_policy.json"
```

Create and attach the policy in the IAM Console:

1. Go to **IAM -> Policies -> Create policy -> JSON** tab. Paste the contents of `.tmp/alb-controller-iam-policy.json`. Name it `AWSLoadBalancerControllerIAMPolicy`. If it already exists from an earlier cluster, reuse it.
2. Go to **IAM -> Roles -> `ridenow-prod-alb-controller` -> Add permissions -> Attach policies**. Select `AWSLoadBalancerControllerIAMPolicy`.

Then restart the controller so it picks the permissions up:

```bash
kubectl rollout restart deployment aws-load-balancer-controller -n kube-system
kubectl rollout status  deployment aws-load-balancer-controller -n kube-system --timeout=300s
kubectl get deploy -n kube-system aws-load-balancer-controller
```

Expected: the last command shows `1/1` under READY.

### 4. External Secrets Operator

External Secrets must decrypt the RDS secrets with the KMS key from [04-data.md](04-data.md) (alias `alias/ridenow-prod-rds`). Write the permission document, then add it to the role in the IAM Console:

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

Go to **IAM -> Roles -> `ridenow-prod-external-secrets` -> Add permissions -> Create inline policy -> JSON** tab. Paste the document above and name it `ridenow-prod-external-secrets-kms`. Skip this if the inline policy already exists.

```bash
EXTERNAL_SECRETS_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/ridenow-prod-external-secrets

helm repo add external-secrets https://charts.external-secrets.io && helm repo update

# webhook.port=9443 is required on Fargate (the default 10250 clashes with the kubelet)
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$EXTERNAL_SECRETS_ROLE_ARN" \
  --set webhook.port=9443 \
  --wait

kubectl get pods -n external-secrets
kubectl get crd | grep external-secrets.io
```

Expected: three pods `Running` and the `external-secrets.io` CRDs listed.

### 5. Namespace

```bash
kubectl apply -f iac/k8s/00-namespace.yaml
kubectl get namespace ridenow
```

Expected: namespace `ridenow` `Active`.

### 6. Pod networking (per-pod security groups)

Each service gets its own security group, allowed only to its own database. Create the six groups and their database rules in the EC2 Console, then give them to the pods with a `SecurityGroupPolicy`.

Go to **EC2 -> Security Groups -> Create security group**, once per service. Set **VPC** to `ridenow-prod-vpc`, leave **Inbound rules** empty and keep the default outbound rule (all traffic). Add a `Name` tag equal to the group name, because the commands below find the groups by that tag.

| Name | Description |
|---|---|
| `ridenow-prod-user-service-sg` | `user-service pods` |
| `ridenow-prod-driver-service-sg` | `driver-service pods` |
| `ridenow-prod-trip-service-sg` | `trip-service pods` |
| `ridenow-prod-payment-service-sg` | `payment-service pods` |
| `ridenow-prod-matching-service-sg` | `matching-service pods` |
| `ridenow-prod-notification-service-sg` | `notification-service pods` |

Then go to **EC2 -> Security Groups -> `ridenow-prod-db-sg` -> Inbound rules -> Edit inbound rules**. Add six rules: **Type** `PostgreSQL`, **Port** `5432`, **Source** each of the six groups above. Skip a rule that already exists.

Read the six ids and apply the policies. The EKS cluster security group stays on every pod because DNS and Redis need it:

```bash
REGION=ap-southeast-1
EKS_CLUSTER_SG_ID=$(aws eks describe-cluster --name ridenow-prod --region $REGION \
  --query cluster.resourcesVpcConfig.clusterSecurityGroupId --output text)
echo "EKS cluster security group: $EKS_CLUSTER_SG_ID"
mkdir -p .tmp
: > .tmp/sgp.yaml
for SVC in user driver trip payment matching notification; do
  SG_ID=$(aws ec2 describe-security-groups --region $REGION \
    --filters "Name=tag:Name,Values=ridenow-prod-$SVC-service-sg" \
    --query "SecurityGroups[0].GroupId" --output text)
  if [ "$SG_ID" = "None" ]; then echo "MISSING: ridenow-prod-$SVC-service-sg (create it in the EC2 Console)"; continue; fi
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
kubectl rollout restart deploy -n ridenow
kubectl get securitygrouppolicy -n ridenow
```

Pods started earlier keep the old security group until restarted, which is why the rollout restart is there (it does nothing on a first install). Expected: six `SecurityGroupPolicy` rows.

### 7. Fargate log router

Do this step in [10-cloudwatch.md](10-cloudwatch.md), in its Post-Deploy step 1 ("Fargate log router"), which applies `iac/k8s/01-aws-logging.yaml`. That guide creates the pod log group `/aws/eks/ridenow-prod/fargate` first, which the log router needs. The `ridenow-prod-observability` Fargate profile from this guide already covers the namespace `aws-observability`. Come back here for step 8.

### 8. Database secrets (ExternalSecrets)

Needs the External Secrets install from step 4 and the six database secret ARNs from **Depends on**.

```bash
USER_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx
DRIVER_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx
TRIP_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx
PAYMENT_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx
MATCHING_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx
NOTIFICATION_DB_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:rds!db-xxxx

sed -e "s|<REGION>|ap-southeast-1|g" \
    -e "s|<ENV>|prod|g" \
    -e "s|<USER_SECRET_ARN>|$USER_DB_SECRET_ARN|g" \
    -e "s|<DRIVER_SECRET_ARN>|$DRIVER_DB_SECRET_ARN|g" \
    -e "s|<TRIP_SECRET_ARN>|$TRIP_DB_SECRET_ARN|g" \
    -e "s|<PAYMENT_SECRET_ARN>|$PAYMENT_DB_SECRET_ARN|g" \
    -e "s|<MATCHING_SECRET_ARN>|$MATCHING_DB_SECRET_ARN|g" \
    -e "s|<NOTIFICATION_SECRET_ARN>|$NOTIFICATION_DB_SECRET_ARN|g" \
    iac/k8s/10-external-secrets.yaml | kubectl apply -f -

kubectl get externalsecret -n ridenow
```

Expected: six rows with `SecretSynced` and READY `True`. If a row shows `SecretSyncedError`, read the reason:

```bash
kubectl logs -n external-secrets deploy/external-secrets --tail=50 | grep -i "error\|denied"
```

### 9. ALB ingress and smoke test

Deploy the seven services from [07-eks-addons.md](07-eks-addons.md#post-deploy) first. Then create the Ingress. Payment must already be running, because trip-service calls it when a trip is created.

```bash
kubectl apply -f iac/k8s/30-ingress.yaml
kubectl get ingress -n ridenow -w
```

Wait for an ADDRESS, then press Ctrl+C. [08-frontend.md](08-frontend.md) uses this ALB DNS name as the CloudFront API origin.

```bash
ADDR=$(kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
ALB_DNS_NAME=$(aws elbv2 describe-load-balancers --region ap-southeast-1 \
  --query "LoadBalancers[?Type=='application' && Scheme=='internet-facing'].DNSName | [0]" --output text)
echo "$ADDR"
echo "$ALB_DNS_NAME"
curl -s "http://$ADDR/api/drivers"
kubectl logs -n ridenow deploy/matching-service --tail=20
kubectl logs -n ridenow deploy/notification-worker --tail=20
```

Expected: both hostnames are the same, `curl` returns JSON (a `200`), and the matching and notification logs show their SQS and Valkey consumers connected. A `503` means the ALB has no healthy target: check `kubectl get pods -n ridenow` and wait until every pod is `Ready`. A pod stuck at `0/1` usually means a wrong database endpoint, secret, security group or Redis endpoint; check `kubectl describe pod <name> -n ridenow`.

## Verify

Run:

```bash
aws eks describe-cluster --name ridenow-prod --region ap-southeast-1 \
  --query "cluster.[endpoint,identity.oidc.issuer,resourcesVpcConfig.clusterSecurityGroupId]" --output text
aws eks describe-cluster --name ridenow-prod --region ap-southeast-1 \
  --query "cluster.[status,version,resourcesVpcConfig.endpointPublicAccess,resourcesVpcConfig.endpointPrivateAccess,encryptionConfig[0].resources[0]]" --output text
aws eks list-fargate-profiles --cluster-name ridenow-prod --region ap-southeast-1 --output text
```

Expected: the first command prints the endpoint URL, the OIDC issuer URL and an `sg-...` id. The second prints `ACTIVE  1.31  True  True  secrets`. The third lists `ridenow-prod-system`, `ridenow-prod-app` and `ridenow-prod-observability`. A missing item means that step was skipped or misspelled.

Check the control-plane logging:

```bash
aws eks describe-cluster --name ridenow-prod --region ap-southeast-1 \
  --query "cluster.logging.clusterLogging[?enabled].types[]" --output text
aws logs describe-log-groups --log-group-name-prefix /aws/eks/ridenow-prod/cluster \
  --region ap-southeast-1 --query "logGroups[].[logGroupName,retentionInDays]" --output text
```

Expected: the first command lists `api audit authenticator controllerManager scheduler`. The second prints `/aws/eks/ridenow-prod/cluster  14`.

Next: `07-eks-addons.md`.
