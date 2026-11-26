# 06 - EKS cluster (control plane and Fargate profiles)

Stack `ridenow-<env>-06-eks-cluster` from `iac/stacks/06-eks-cluster.yaml`.
Depends on: `01-iam` (imports `ClusterRoleArn`, `FargatePodExecutionRoleArn`) and `02-network` (imports `PrivateSubnetIds`, `NodeSecurityGroupId`).

## What it creates

- A KMS key (rotation enabled) used for Kubernetes secrets envelope encryption.
- An EKS cluster `ridenow-<env>` with the public endpoint enabled, running on the private subnets. Its secrets are encrypted with the KMS key above.
- Three AWS Fargate profiles, so pods run on serverless Fargate and no EC2 nodes exist:
  - `ridenow-<env>-system` for the `kube-system` and `external-secrets` namespaces (CoreDNS, AWS Load Balancer Controller, External Secrets).
  - `ridenow-<env>-app` for the `ridenow` namespace (the seven application services).
  - `ridenow-<env>-observability` for the `aws-observability` namespace (the log router configuration).
- The three profiles are created one after another (system, then app, then observability), because EKS accepts only one Fargate profile creation at a time per cluster.
- Exports: `ClusterName`, `ClusterEndpoint`, `OidcIssuerUrl` and `ClusterSecurityGroupId`. Fargate pods attach to the cluster security group that EKS creates, which is why `ClusterSecurityGroupId` is exported for stack `07-eks-addons`.

The cluster has no workloads and no working DNS yet. The Post-Deploy steps below make it usable.

## Deploy

### Configure

Show the parameters this stack will receive from `iac/params/$ENV.json`:

```bash
params 06-eks-cluster
```

Expected for `prod`: `Environment=prod`, `KubernetesVersion=1.31`.

`KubernetesVersion` is the only tunable parameter. To use another EKS version for one run, pass it to `cfn_deploy` (see Run below).

### Run

Deploy the stack with the shared helper. This is the slowest stack: the control plane and the three serial Fargate profiles usually take 10 to 15 minutes, and the command prints no progress until it finishes.

```bash
cfn_deploy 06-eks-cluster
```

Expected last line: `Successfully created/updated stack - ridenow-prod-06-eks-cluster`.

To use a different Kubernetes version once:

```bash
cfn_deploy 06-eks-cluster KubernetesVersion=1.31
```

Check the stack status:

```bash
stack_status 06-eks-cluster
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

### If it fails

Show the newest failed events and their reasons:

```bash
stack_failures 06-eks-cluster
```

`Export ... cannot be imported` or `No export named ...iam-...` / `...network-...`: deploy `01-iam.md` and `02-network.md` first. A stack in `ROLLBACK_COMPLETE` must be deleted before it can be deployed again (see `README.md`).

## Post-Deploy

These steps are not CloudFormation. The commands come from `iac/scripts/deploy-and-test.sh` (steps 2 to 8) and `iac/scripts/alb-controller-policy.sh`. Run them in order, in the same WSL shell where you ran `source guides/cloudformation/env.sh`.

The scripts run them after all seven stacks exist. The AWS Load Balancer Controller subsection below reads the role `exp eks-AlbControllerRoleArn`, which is created by `07-eks-addons`. Deploy `07-eks-addons.md` (the Deploy part, up to `stack_status`) before you reach that subsection. The External Secrets subsection needs the same stack. The kubeconfig and CoreDNS subsections need only this stack.

### kubectl and kubeconfig setup

Write the cluster into your kubeconfig so `kubectl` and `helm` talk to `ridenow-$ENV`:

```bash
aws eks update-kubeconfig --name ridenow-$ENV
```

Expected: a line starting with `Updated context arn:aws:eks:` (the script discards this output with `>/dev/null`; the guide keeps it so you can see which context was written).

Confirm the API server answers:

```bash
kubectl get svc kubernetes
```

Expected: one row, `kubernetes   ClusterIP   ...   443/TCP`. A timeout means the credentials in use are not the ones that created the cluster, or the public endpoint is unreachable from your network.

### CoreDNS on Fargate

EKS installs CoreDNS with a `compute-type: ec2` annotation, so its pods stay `Pending` on a cluster with no EC2 nodes. Remove the annotation only if it is still present. The `grep` guard is the same as in `deploy-and-test.sh` and makes the step safe to repeat, because the JSON patch fails when the annotation is already gone:

```bash
if kubectl get deployment coredns -n kube-system -o jsonpath='{.spec.template.metadata.annotations}' | grep -q compute-type; then
  kubectl patch deployment coredns -n kube-system --type=json \
    -p='[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'
fi
```

Expected: either `deployment.apps/coredns patched` or no output (annotation already removed).

Pods created before the `kube-system` Fargate profile became `ACTIVE` stay `Pending` forever. Restart CoreDNS only when it is not fully available, then wait for the rollout. This is the same check as the script, written out as one block:

```bash
want=$(kubectl get deployment coredns -n kube-system -o jsonpath='{.spec.replicas}')
have=$(kubectl get deployment coredns -n kube-system -o jsonpath='{.status.availableReplicas}')
if [[ "${have:-0}" != "$want" ]]; then
  kubectl rollout restart deployment coredns -n kube-system
fi
kubectl rollout status deployment coredns -n kube-system --timeout=600s
```

Expected last line: `deployment "coredns" successfully rolled out`. Fargate pods take 1 to 2 minutes to start.

If the `patch` command reports `unable to find a path to remove`, the annotation is already gone. Skip the patch and continue with the restart check.

### AWS Load Balancer Controller

The controller turns the `Ingress` into an Application Load Balancer. It runs in `kube-system`, so it uses the `system` Fargate profile. Install it in two parts: the Helm release, then the IAM permissions policy.

Add the chart repositories. The script also adds `external-secrets` here, which this guide leaves to its own subsection:

```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update
```

Expected: `"eks" has been added to your repositories` (or `already exists`).

Read the two stack exports the chart needs. The script uses its own `need_exp`, which stops with an error when an export is empty. This guide uses the shared `exp` helper, which returns an empty string instead, so check the values yourself. An empty `role-arn` installs without error and fails later with `AccessDenied`:

```bash
ALB_ROLE_ARN=$(exp eks-AlbControllerRoleArn)
VPC_ID=$(exp network-VpcId)
echo "role=$ALB_ROLE_ARN vpc=$VPC_ID"
```

Expected: both values print, `role=arn:aws:iam::<account>:role/ridenow-<env>-alb-controller vpc=vpc-...`. If `role=` is empty, deploy `07-eks-addons` first.

Install the chart. The flags are the same as in `deploy-and-test.sh` step 4. The script sends the output to `/dev/null`; the guide keeps it so you can see the release status.

```bash
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName=ridenow-$ENV \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$ALB_ROLE_ARN" \
  --set region=$AWS_REGION \
  --set vpcId=$VPC_ID \
  --wait --timeout 10m
```

Expected: `STATUS: deployed`. `region` and `vpcId` are set explicitly because on Fargate the controller cannot read them from the instance metadata service.

Stack `07-eks-addons` creates the controller's IAM role with a trust policy only. The permissions policy is published by the controller project and changes between controller versions, so it is not in the template. The next commands do what `iac/scripts/alb-controller-policy.sh` does, one step at a time. The only difference is that they read `$ENV`, `$AWS_REGION` and `$ACCOUNT_ID` from `env.sh` instead of a script argument.

Find the controller version that Helm installed:

```bash
VERSION=$(helm list -n kube-system -o json \
  | jq -r '.[] | select(.name=="aws-load-balancer-controller") | .app_version')
echo "controller version: $VERSION"
```

Expected: a version such as `v2.13.0`. An empty value or `null` means the Helm release is not installed in `kube-system`; repeat the install above.

Download the policy document for exactly that version:

```bash
mkdir -p .tmp
curl -fsSL -o .tmp/alb-iam-policy.json \
  "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${VERSION}/docs/install/iam_policy.json"
```

Expected: no output, and `.tmp/alb-iam-policy.json` exists. The script uses `mktemp` and deletes the file on exit; the guide writes to `.tmp/` (gitignored) so you can inspect it.

Create the customer-managed policy, or add a new version if it already exists. IAM keeps at most 5 versions of a policy, so when 5 exist the oldest non-default one is deleted first:

```bash
POLICY_NAME=AWSLoadBalancerControllerIAMPolicy
POLICY_ARN=arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}
if aws iam get-policy --policy-arn $POLICY_ARN >/dev/null 2>&1; then
  COUNT=$(aws iam list-policy-versions --policy-arn $POLICY_ARN --query 'length(Versions)' --output text)
  if [[ "$COUNT" -ge 5 ]]; then
    OLDEST=$(aws iam list-policy-versions --policy-arn $POLICY_ARN \
      --query 'Versions[?IsDefaultVersion==`false`]|[-1].VersionId' --output text)
    aws iam delete-policy-version --policy-arn $POLICY_ARN --version-id $OLDEST
  fi
  aws iam create-policy-version --policy-arn $POLICY_ARN \
    --policy-document file://.tmp/alb-iam-policy.json --set-as-default >/dev/null
else
  aws iam create-policy --policy-name $POLICY_NAME \
    --policy-document file://.tmp/alb-iam-policy.json >/dev/null
fi
```

Expected: no output. Both branches are safe to repeat.

Attach the policy to the controller's role:

```bash
aws iam attach-role-policy --role-name ridenow-$ENV-alb-controller --policy-arn $POLICY_ARN
```

Expected: no output. Attaching an already attached policy succeeds.

Restart the controller so it picks up the new permissions, and wait for it:

```bash
kubectl rollout restart deployment aws-load-balancer-controller -n kube-system
kubectl rollout status deployment aws-load-balancer-controller -n kube-system --timeout=300s
```

Expected last line: `deployment "aws-load-balancer-controller" successfully rolled out`.

Without the policy, the `Ingress` never gets an address and the controller logs `AccessDenied ... elasticloadbalancing:DescribeLoadBalancers`. To check, run `kubectl logs -n kube-system deployment/aws-load-balancer-controller --tail=20` and look for that text.

### External Secrets Operator with the KMS grant

External Secrets Operator (ESO) copies the six database passwords from AWS Secrets Manager into Kubernetes secrets. It runs in the `external-secrets` namespace, which the `system` Fargate profile covers. It needs the IAM role from `07-eks-addons` and permission to decrypt with the RDS KMS key. These steps are `deploy-and-test.sh` step 5. Deploy `07-eks-addons.md` (up to `stack_status`) first.

Read the role and the key, and check both values. The script uses `need_exp`, which stops on an empty export; `exp` returns an empty string, so check it yourself:

```bash
ESO_ROLE=$(exp eks-ExternalSecretsRoleArn)
KMS_ARN=$(aws kms describe-key --key-id alias/ridenow-$ENV-rds --query KeyMetadata.Arn --output text)
echo "role=$ESO_ROLE"
echo "key=$KMS_ARN"
```

Expected: `role=arn:aws:iam::<account>:role/...` and `key=arn:aws:kms:ap-southeast-1:<account>:key/...`. If `role=` is empty, deploy `07-eks-addons` first. If `describe-key` fails with `NotFoundException`, deploy `04-data` first.

Create the KMS grant so the role can decrypt the secrets. The grant is matched by `GranteePrincipal`, not by name. A grant left from an earlier cluster names a role that was deleted and recreated, and does not apply to the new role, so a name match would wrongly skip creating a new grant:

```bash
if aws kms list-grants --key-id "$KMS_ARN" --query "Grants[?GranteePrincipal=='$ESO_ROLE'].GrantId" --output text | grep -q .; then
  echo "KMS grant for $ESO_ROLE exists"
else
  aws kms create-grant --key-id "$KMS_ARN" --grantee-principal "$ESO_ROLE" \
    --operations Decrypt DescribeKey --name "eso-decrypt-ridenow-$ENV" --query GrantId --output text >/dev/null
  echo "created KMS grant for $ESO_ROLE"
fi
```

Expected: `created KMS grant for arn:...` on the first run, `KMS grant for arn:... exists` on a repeat.

Add the chart repository (the AWS Load Balancer Controller subsection already ran `helm repo update` for `eks`; run it again so the new repository is indexed):

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
```

Expected: `"external-secrets" has been added to your repositories` (or `already exists`).

Install the chart. `webhook.port=9443` is required on Fargate. The chart default is `10250`, which is the Fargate kubelet's port, so the API server's webhook calls would reach the kubelet instead of ESO and every `ExternalSecret` apply would fail.

```bash
helm upgrade --install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$ESO_ROLE" \
  --set webhook.port=9443 \
  --wait --timeout 10m
```

Expected: `STATUS: deployed`. The script sends the output to `/dev/null`; the guide keeps it.

Check the pods:

```bash
kubectl get pods -n external-secrets
```

Expected: three pods (`external-secrets`, `external-secrets-cert-controller`, `external-secrets-webhook`), each `1/1 Running`. Fargate pods take 1 to 2 minutes to start.

Differences from the scripts:

- The KMS grant name is `eso-decrypt-ridenow-$ENV` here, which is the script's `eso-decrypt-${CLUSTER}`. The older `guides/aws/00-deploy-runbook.md` uses `eso-decrypt-grant`. The name does not matter for matching, because the check is by grantee.
- `exp` replaces `need_exp`, as in the previous subsection.

### Namespace creation

The seven services, the `ExternalSecret` objects and the pod networking policies live in the `ridenow` namespace, which the `app` Fargate profile covers. Create it before anything else in that namespace. This is the first command of `deploy-and-test.sh` step 6; run it from the repository root:

```bash
k8s_apply 00-namespace
```

Expected: `namespace/ridenow created` (or `unchanged` on a repeat).

```bash
kubectl get namespace ridenow --show-labels
```

Expected: `ridenow   Active   ...   app.kubernetes.io/part-of=ridenow`.

### Pod networking

On Fargate every pod already has its own network interface. A `SecurityGroupPolicy` attaches chosen security groups to the pods whose labels match. The next steps give each of six services its own security group and let only that group reach the database. No `ENABLE_POD_ENI` setting is needed, because that flag is for EC2 nodes.

This subsection is not in `deploy-and-test.sh`. The script never creates a `SecurityGroupPolicy`; every pod keeps the EKS cluster security group. The commands below come from `guides/aws/00-deploy-runbook.md` (Phase 5.2) and are optional. Skip them if you accept one shared group for all pods. Without them the services still work, because stack `07-eks-addons` already admits the cluster security group to the database and Redis security groups.

How the groups relate (checked against `iac/stacks/02-network.yaml` and `iac/stacks/07-eks-addons.yaml`):

- `02-network` creates `ClusterSecurityGroup` (`ridenow-<env>-cluster-sg`, exported as `network-NodeSecurityGroupId`) and `DbSecurityGroup` (exported as `network-DbSecurityGroupId`). `DbSecurityGroup` allows port 5432 only from `ClusterSecurityGroup`.
- Fargate pods do not use `ClusterSecurityGroup`. They use the security group EKS creates for the cluster (export `eks-ClusterSecurityGroupId`). That is why `07-eks-addons` adds ingress rules from `eks-ClusterSecurityGroupId` to the database (5432) and Redis (6379) groups.
- The per-service groups below are a third set. Each is created by the CLI, not by CloudFormation, and is allowed on 5432 of `DbSecurityGroup`. The policy attaches both the service group and `eks-ClusterSecurityGroupId` to each pod. The cluster group stays because DNS, the control plane and Redis depend on it.
- Because every database sits on the same `DbSecurityGroup` and the cluster group is also allowed on 5432, the extra groups document intent but do not block a pod from another database. Real per-database isolation needs a separate database security group per service. This is a limit of the current stacks, not of this guide.

Create one security group per service, open the database port to it, and write one `SecurityGroupPolicy` per service. The script is safe to repeat. It writes the manifest to `.tmp/` (gitignored); the runbook uses `/tmp/sgp.yaml`:

```bash
VPC_ID=$(exp network-VpcId)
DB_SG=$(exp network-DbSecurityGroupId)
CLUSTER_SG=$(exp eks-ClusterSecurityGroupId)
echo "vpc=$VPC_ID db-sg=$DB_SG cluster-sg=$CLUSTER_SG"
mkdir -p .tmp
: > .tmp/sgp.yaml

for SVC in user driver trip payment matching notification; do
  NAME=ridenow-$ENV-${SVC}-service-sg
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
      - ${CLUSTER_SG}
EOF
  echo "$APP -> $SG_ID"
done
```

Expected: first the `vpc=... db-sg=... cluster-sg=...` line with three non-empty ids, then six lines `user-service -> sg-...` through `notification-worker -> sg-...`. `realtime-gateway` has no database, so it has no policy and keeps the cluster group only. The `|| true` hides the duplicate-rule error on a repeat run.

Apply the policies:

```bash
kubectl apply -f .tmp/sgp.yaml
kubectl get securitygrouppolicy -n ridenow
```

Expected: six `*-sgp` rows. A policy applies only to pods created after it exists. The seven services are deployed later in `07-eks-addons.md`, so no restart is needed on a fresh cluster. If services are already running, restart them so they pick up the groups:

```bash
kubectl rollout restart deploy -n ridenow
```

Differences from the repository's commands: `$ENV` replaces the literal `prod` in the group name, and the manifest goes to `.tmp/sgp.yaml` instead of `/tmp/sgp.yaml`. The six security groups and their database ingress rules are not CloudFormation resources, so they are not removed when a stack is deleted.

### Database secrets

The six `ExternalSecret` objects copy each database's master password from Secrets Manager into a Kubernetes secret in `ridenow`. This is `deploy-and-test.sh` step 6, after the namespace. It needs External Secrets Operator (above) and the `04-data` exports `<Service>DbSecretArn`.

Difference from the other manifests: `k8s_apply 10-external-secrets` cannot be used. The helper in `env.sh` does not fill `<USER_SECRET_ARN>` and the five other secret placeholders, so `kubectl apply` would send them unchanged and ESO could not find the secrets. The script fills them with its own `sed`, and the commands below do the same, reading each export with `exp`. Check that all six values are non-empty first:

```bash
for S in User Driver Trip Payment Matching Notification; do
  echo "$S -> $(exp data-${S}DbSecretArn)"
done
```

Expected: six lines, each ending in `arn:aws:secretsmanager:ap-southeast-1:<account>:secret:rds!db-...`. An empty value means `04-data` is not deployed.

Fill the placeholders and apply (run from the repository root):

```bash
sed -e "s|<REGION>|$AWS_REGION|g" \
    -e "s|<USER_SECRET_ARN>|$(exp data-UserDbSecretArn)|g" \
    -e "s|<DRIVER_SECRET_ARN>|$(exp data-DriverDbSecretArn)|g" \
    -e "s|<TRIP_SECRET_ARN>|$(exp data-TripDbSecretArn)|g" \
    -e "s|<PAYMENT_SECRET_ARN>|$(exp data-PaymentDbSecretArn)|g" \
    -e "s|<MATCHING_SECRET_ARN>|$(exp data-MatchingDbSecretArn)|g" \
    -e "s|<NOTIFICATION_SECRET_ARN>|$(exp data-NotificationDbSecretArn)|g" \
    iac/k8s/10-external-secrets.yaml | kubectl apply -f -
```

Expected: `clustersecretstore.external-secrets.io/ridenow-secrets created` and six `externalsecret.external-secrets.io/<service>-db-credentials created` lines. An error `failed calling webhook` means the webhook port is not `9443` (see the previous subsection).

Wait until all six are synced:

```bash
kubectl wait --for=condition=Ready externalsecret --all -n ridenow --timeout=300s
kubectl get externalsecret -n ridenow
```

Expected: six `condition met` lines, then six rows with `STATUS` `SecretSynced` and `READY` `True`. If the wait times out, run `kubectl logs -n external-secrets deploy/external-secrets --tail=20`. `AccessDenied` or a KMS error means the grant or the IAM role is wrong (see the External Secrets subsection).

### ALB ingress

One internet-facing Application Load Balancer fronts the public APIs by path. `iac/k8s/30-ingress.yaml` has no placeholders, and `k8s_apply` is the shared helper for manifests, so it is used here (the script runs `kubectl apply -f` on the same file):

```bash
k8s_apply 30-ingress
```

Expected: `ingress.networking.k8s.io/ridenow created` (or `unchanged`). The Ingress needs the AWS Load Balancer Controller with its policy attached. The services it routes to are deployed in `07-eks-addons.md`, which is why the Ingress is applied in the script after the services. Applying it earlier is safe, and the ALB is still created.

Wait for the ALB address. The loop is the one in the script (60 tries, 10 seconds apart):

```bash
HOST=""
for _ in $(seq 1 60); do
  HOST=$(kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  [[ -n "$HOST" ]] && break
  sleep 10
done
echo "ALB host: $HOST"
```

Expected: `ALB host: k8s-ridenow-ridenow-<id>.ap-southeast-1.elb.amazonaws.com` within 2 to 3 minutes. If `HOST` stays empty, run `kubectl describe ingress ridenow -n ridenow | tail -10`. A line with `AccessDenied ... elasticloadbalancing:DescribeLoadBalancers` means the controller's IAM policy is missing: repeat the policy, attach and restart steps in "AWS Load Balancer Controller".

### Smoke test

The ALB answers `200` only when `user-service` is running and its target is healthy. On a fresh cluster the services come from `07-eks-addons.md`, so run this subsection after the per-service steps there. Until then it returns `503`. The loop is the script's (60 tries, 10 seconds apart; DNS and target health take a few minutes):

```bash
BASE="http://$HOST"
code=000
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE/api/users?limit=1" || true)
  [[ "$code" == "200" ]] && break
  sleep 10
done
echo "last status: $code"
```

Expected: `last status: 200`. The script stops with an error after 10 minutes without `200`; this guide only prints the last code. `503` means no healthy target yet, `404` means the Ingress rule is missing.

The script then runs `scripts/api-test.ps1` through PowerShell. That step is left out because this guide is Bash only.

## Verify

Check the cluster status and the Kubernetes version:

```bash
aws eks describe-cluster --name ridenow-$ENV --query 'cluster.[status,version]' --output text
```

Expected: `ACTIVE  1.31` (the version you set).

Check the three Fargate profiles:

```bash
for P in system app observability; do
  aws eks describe-fargate-profile --cluster-name ridenow-$ENV \
    --fargate-profile-name ridenow-$ENV-$P --query 'fargateProfile.[fargateProfileName,status]' --output text
done
```

Expected: three lines `ridenow-prod-system  ACTIVE`, `ridenow-prod-app  ACTIVE`, `ridenow-prod-observability  ACTIVE`.

Check that secrets encryption uses KMS:

```bash
aws eks describe-cluster --name ridenow-$ENV --query 'cluster.encryptionConfig[0].resources' --output text
```

Expected: `secrets`.

Check that the CoreDNS deployment is running with both replicas available:

```bash
kubectl get deployment coredns -n kube-system
```

Expected: `READY` shows `2/2` and `AVAILABLE` is `2`. If the pods stay `Pending`, the `compute-type` annotation is still present: run the guarded patch in "CoreDNS on Fargate" again, then the restart check.

Check the three exports that `07-eks-addons` and the rest of the guides read:

```bash
exp eks-ClusterSecurityGroupId
exp eks-OidcIssuerUrl
exp eks-ClusterEndpoint
```

Expected: `sg-...`, then `https://oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`, then `https://<id>.<suffix>.ap-southeast-1.eks.amazonaws.com`.

Check the stack status and the add-ons installed above:

```bash
stack_status 06-eks-cluster
helm list -A --short
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE`), then `aws-load-balancer-controller` and `external-secrets`.

## Final check

Run these once the whole deployment is finished. They only read. The stack status is already in Verify above. The API check through the ALB is at the end of `07-eks-addons.md`, because it returns `200` only after the services from that guide are running.

Check the ExternalSecrets:

```bash
kubectl get externalsecret -n ridenow
```

Expected: six rows with `STATUS` `SecretSynced` and `READY` `True`.

Check the ALB ingress address:

```bash
kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'; echo
```

Expected: `k8s-ridenow-ridenow-<id>.ap-southeast-1.elb.amazonaws.com`. An empty line means the ingress has no address yet.

Next: `07-eks-addons.md`.
