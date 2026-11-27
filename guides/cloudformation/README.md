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

**Values from earlier guides.** Each guide's **Depends on** table lists the values to look
up before you start, which guide created each one, and where to find it in the console. You
do not need to run anything before a guide. The
[Discovery_Block](#discovery_block---load-every-non-fixed-value-from-aws) below is only for
the checks at the end of this README and the teardown steps. It changes nothing in AWS.

> Cost: the EKS control plane, NAT gateways, Multi-AZ RDS and ElastiCache bill by the hour
> from the moment they are created.

## The order

Follow the guides in numeric order, from `01-iam.md` up to `08-frontend.md`.

| Guide | AWS services it creates | Non-console steps included |
|-------|-------------------------|----------------------------|
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
address yet; see the ALB ingress step in the Post-Deploy section of [06-eks-cluster.md](06-eks-cluster.md#post-deploy).

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

## Discovery_Block - load every non-fixed value from AWS

Paste this once per terminal, from the repo root, when a step in this README tells you to
(the final checks and the teardown). The guides do not need it: each guide's **Depends on**
table lists what to look up. It only reads: every AWS call is
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

# ---- ALB created by the Ingress (06-eks-cluster.md Post-Deploy): found by the controller's cluster tag ----
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
show ALB_DNS_NAME "ALB tagged elbv2.k8s.aws/cluster=$CLUSTER_NAME" "30-ingress.yaml (06-eks-cluster.md Post-Deploy)"
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

## Redeploy after the cluster is recreated

Use this when `kubectl` says `no such host`, or the ALB returns `503`. The new
cluster is empty, so you redeploy what runs inside it.

```bash
# 1. Point kubectl at the new cluster
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"

# 2. Check it is empty (expect "No resources found")
kubectl get pods,ingress -n ridenow
```

3. Repeat the Post-Deploy steps of [06-eks-cluster.md](06-eks-cluster.md#post-deploy), then the deploy steps of [07-eks-addons.md](07-eks-addons.md#post-deploy). Skip the image build in [03-ecr.md](03-ecr.md) (images are still in ECR).

```bash
# 4. Wait until every pod is Running and Ready
kubectl get pods -n ridenow

# 5. Get the ALB hostname
kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'; echo
```

6. If the hostname changed, update the `A=` ALB hostname variable wherever you keep it for manual tests.

---

## Teardown order

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
