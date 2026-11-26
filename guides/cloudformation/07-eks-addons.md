# 07 - EKS add-ons (OIDC provider, IRSA roles, application services)

Stack `ridenow-<env>-07-eks-addons` from `iac/stacks/07-eks-addons.yaml`.
Depends on: `01-iam` (imports the four `*MessagingPolicyArn` exports), `02-network` (imports `DbSecurityGroupId`), `05-messaging` (imports `RedisSecurityGroupId`, only when `EnableRedisAccess=true`) and `06-eks-cluster` (imports `ClusterSecurityGroupId`; the cluster's OIDC issuer id is read live, see Deploy).

## What it creates

- An IAM OIDC identity provider for the EKS cluster, so Kubernetes service accounts can assume IAM roles (IRSA).
- Six IRSA roles. Each trusts only its own service account:
  - `ridenow-<env>-alb-controller` for `kube-system/aws-load-balancer-controller`.
  - `ridenow-<env>-external-secrets` for `external-secrets/external-secrets`. It can read the RDS-managed secrets in Secrets Manager.
  - `ridenow-<env>-trip-service`, `ridenow-<env>-payment-service`, `ridenow-<env>-matching-service` and `ridenow-<env>-notification-worker` for the same-named service accounts in the `ridenow` namespace. Each carries only its own messaging policy from `01-iam`.
- Two security group ingress rules that let the Fargate pods (cluster security group) reach PostgreSQL on port 5432 (database security group) and Redis on port 6379 (Redis security group). Without them every pod times out and crash-loops.

`user-service`, `driver-service` and `realtime-gateway` need no AWS API access, so they have no role.

All resources are created only when `EnableAddons=true` and `OidcProviderId` is not blank.

## Deploy

Dependencies: `01-iam`, `02-network`, `05-messaging` and `06-eks-cluster` must be `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

### Configure

Show the parameters this stack will receive from `iac/params/$ENV.json`:

```bash
params 07-eks-addons
```

Expected for `prod`: `Environment=prod`, `EnableAddons=true`. `OidcProviderId` is not in the file because the cluster must exist before its value does. If you deployed `05-messaging` without Redis, also pass `EnableRedisAccess=false` in the Run step.

### Run

Look up the cluster's OIDC issuer id. It is the last path segment of the issuer URL. This is the same lookup `iac/scripts/deploy.sh` does for this layer, and it is why the command below differs from a plain `cfn_deploy 07-eks-addons`.

```bash
OIDC_ID=$(aws eks describe-cluster --name ridenow-$ENV \
  --query 'cluster.identity.oidc.issuer' --output text | sed 's|.*/||')
echo $OIDC_ID
```

Expected: a 32-character uppercase hexadecimal id such as `EXAMPLED539D4633E53DE1B716D3041E`. If it prints nothing or `None`, `06-eks-cluster` is not deployed yet.

Deploy the stack with the id as an override. Without it the stack is created empty.

```bash
cfn_deploy 07-eks-addons OidcProviderId=$OIDC_ID
```

Expected last line: `Successfully created/updated stack - ridenow-prod-07-eks-addons`.

Check the stack status:

```bash
stack_status 07-eks-addons
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

### If it fails

Show the newest failed events and their reasons:

```bash
stack_failures 07-eks-addons
```

`No export named ...eks-ClusterSecurityGroupId` or `...iam-...PolicyArn`: deploy `06-eks-cluster.md` or `01-iam.md` first. `No export named ...messaging-RedisSecurityGroupId`: deploy `05-messaging.md`, or redeploy this stack with `EnableRedisAccess=false` if you run without Redis. A stack in `ROLLBACK_COMPLETE` must be deleted before it can be deployed again (see `README.md`).

## Post-Deploy

### IRSA roles

Confirm the cluster OIDC provider is registered in IAM. This lists the provider created by this stack.

```bash
aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn, '$OIDC_ID')].Arn" --output text
```

Expected: one ARN ending in `oidc-provider/oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC_ID>`.

Confirm each role trusts its own service account. This prints the role name and the `sub` condition from its trust policy.

```bash
for ROLE in alb-controller external-secrets trip-service payment-service matching-service notification-worker; do
  aws iam get-role --role-name ridenow-$ENV-$ROLE \
    --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals' --output json \
    | jq -r --arg r "$ROLE" 'to_entries[] | select(.key | endswith(":sub")) | "\($r)  \(.value)"'
done
```

Expected: six lines, one per role:

```text
alb-controller  system:serviceaccount:kube-system:aws-load-balancer-controller
external-secrets  system:serviceaccount:external-secrets:external-secrets
trip-service  system:serviceaccount:ridenow:trip-service
payment-service  system:serviceaccount:ridenow:payment-service
matching-service  system:serviceaccount:ridenow:matching-service
notification-worker  system:serviceaccount:ridenow:notification-worker
```

Confirm the four application role ARNs are exported. `k8s_apply` reads them to fill the service account annotations in the next subsections.

```bash
stack_outputs 07-eks-addons
```

Expected: six rows: `TripServiceRoleArn`, `PaymentServiceRoleArn`, `MatchingServiceRoleArn`, `NotificationWorkerRoleArn`, `AlbControllerRoleArn`, `ExternalSecretsRoleArn`.

### Application services

Deploy the seven services in the order below. Payment goes before trip because trip authorizes payments synchronously. Driver goes before matching because driver writes the location stream that matching reads. This is the order of `MANIFESTS` in `iac/scripts/deploy-and-test.sh`.

Before you start, these must already be done:

- The images for `$IMAGE_TAG` are pushed to ECR (`03-ecr.md`).
- The `ridenow` namespace and the database secrets exist (`06-eks-cluster.md`: Namespace creation and Database secrets).
- `kubectl` points at the cluster (`06-eks-cluster.md`: kubectl and kubeconfig setup).

Run every command from the repository root, because `k8s_apply` reads `iac/k8s/<name>.yaml` by relative path. `k8s_apply` fills each `<PLACEHOLDER>` in the manifest from `env.sh` and from the stack exports, then runs `kubectl apply`. One difference from `deploy-and-test.sh`: that script renders all seven manifests, stops if any placeholder is left, and applies them in one pass before waiting. Here each service is applied and awaited on its own, so a failure is easy to attribute to one service.

Each `rollout status` waits until the new pods pass their readiness probe. Fargate has to start a node for every pod, so allow several minutes per service.

### payment-service

Apply the payment-service manifest and wait until its rollout finishes:

```bash
k8s_apply 23-payment-service
kubectl rollout status deployment/payment-service -n ridenow --timeout=900s
```

Expected: the apply prints `deployment.apps/payment-service ...`, `service/payment-service ...` and `serviceaccount/payment-service ...` (`created` or `configured`), and the last line is `deployment "payment-service" successfully rolled out`.

### user-service

Apply the user-service manifest and wait until its rollout finishes:

```bash
k8s_apply 20-user-service
kubectl rollout status deployment/user-service -n ridenow --timeout=900s
```

Expected: last line `deployment "user-service" successfully rolled out`.

### driver-service

Apply the driver-service manifest and wait until its rollout finishes:

```bash
k8s_apply 21-driver-service
kubectl rollout status deployment/driver-service -n ridenow --timeout=900s
```

Expected: last line `deployment "driver-service" successfully rolled out`.

### trip-service

Apply the trip-service manifest and wait until its rollout finishes:

```bash
k8s_apply 22-trip-service
kubectl rollout status deployment/trip-service -n ridenow --timeout=900s
```

Expected: last line `deployment "trip-service" successfully rolled out`.

### matching-service

Apply the matching-service manifest and wait until its rollout finishes:

```bash
k8s_apply 24-matching-service
kubectl rollout status deployment/matching-service -n ridenow --timeout=900s
```

Expected: last line `deployment "matching-service" successfully rolled out`.

### notification-worker

Apply the notification-worker manifest and wait until its rollout finishes:

```bash
k8s_apply 25-notification-worker
kubectl rollout status deployment/notification-worker -n ridenow --timeout=900s
```

Expected: last line `deployment "notification-worker" successfully rolled out`. This service runs one replica.

### realtime-gateway

Apply the realtime-gateway manifest and wait until its rollout finishes:

```bash
k8s_apply 26-realtime-gateway
kubectl rollout status deployment/realtime-gateway -n ridenow --timeout=900s
```

Expected: last line `deployment "realtime-gateway" successfully rolled out`.

If a rollout times out or a pod is not Ready, inspect it:

```bash
kubectl get pods -n ridenow
kubectl describe pod -n ridenow -l app=<service>
kubectl logs -n ridenow deployment/<service> --tail=50
```

`ImagePullBackOff` means the tag `$IMAGE_TAG` is not in ECR (see `03-ecr.md`). `CreateContainerConfigError` on a secret usually means the ExternalSecrets did not sync (`kubectl get externalsecret -n ridenow`). A pod stuck in `Pending` for more than a few minutes means no Fargate profile matches the namespace (see `06-eks-cluster.md`). Timeouts to PostgreSQL or Redis in the logs mean the ingress rules from this stack or the per-pod `SecurityGroupPolicy` from `06-eks-cluster.md` are missing.

## Verify

List the pods in the namespace:

```bash
kubectl get pods -n ridenow
kubectl get pods -n ridenow --no-headers | awk '$3=="Running" && $2 ~ /^([0-9]+)\/\1$/' | wc -l
```

Expected: 13 pods, all with `READY` `1/1` and `STATUS` `Running`: two each for `user-service`, `driver-service`, `trip-service`, `payment-service`, `matching-service` and `realtime-gateway`, and one for `notification-worker`. The count on the last line is `13`.

List the deployments:

```bash
kubectl get deployments -n ridenow
```

Expected: seven deployments. `READY` is `2/2` for six of them and `1/1` for `notification-worker`.

Check that no deployment is waiting on replicas:

```bash
kubectl get deployments -n ridenow \
  -o jsonpath='{range .items[*]}{.metadata.name}{"  "}{.status.availableReplicas}{"/"}{.spec.replicas}{"\n"}{end}'
```

Expected: seven lines where the two numbers are equal, for example `trip-service  2/2`.

Check the stack status once more:

```bash
stack_status 07-eks-addons
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

## Final check

Run this once the whole deployment is finished. It only reads. The API check goes here, not in `06-eks-cluster.md`, because it returns `200` only after the services deployed in this guide are running.

Check the API through the ALB. This is the smoke test from `06-eks-cluster.md`:

```bash
HOST=$(kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "ALB host: $HOST"
BASE="http://$HOST"
code=000
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE/api/users?limit=1" || true)
  [[ "$code" == "200" ]] && break
  sleep 10
done
echo "last status: $code"
```

Expected: `ALB host: k8s-ridenow-ridenow-<id>.ap-southeast-1.elb.amazonaws.com`, then `last status: 200`. An empty host means the ingress has no address yet (see `06-eks-cluster.md`, ALB ingress).

If every check in the guides matches, the deployment is complete.

Next: this is the last step. Return to `README.md` for the index.
