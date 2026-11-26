# 01 - IAM

Stack `ridenow-<env>-01-iam` from `iac/stacks/01-iam.yaml`. Depends on: none.

## What it creates

| Resource | Name | Used by |
|----------|------|---------|
| EKS cluster role | `ridenow-<env>-eks-cluster-role` | stack 06 (control plane) |
| Fargate pod execution role | `ridenow-<env>-eks-fargate-pod-execution-role` | stack 06 (pulls images, ships logs) |
| Managed policy | `ridenow-<env>-app-access` | applications |
| Messaging policies | `ridenow-<env>-{trip-service,payment-service,matching-service,notification-worker}-messaging` | stack 07 attaches each to its service role |

Each messaging policy names the exact topic or queue its service uses, so for example the
notification worker cannot read the payment queue.

## Deploy

Dependencies: none. This stack can be deployed right after `00-prerequisites.md`.

### Configure

The only parameter is `Environment`. Show its value for the current environment.

```bash
params 01-iam
```

Expected: `Environment=prod`.

### Run

Create or update the stack.

```bash
cfn_deploy 01-iam
```

Expected last line: `Successfully created/updated stack - ridenow-prod-01-iam`.

Check the stack status.

```bash
stack_status 01-iam
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a re-run).

### If it fails

List the newest failed events for this stack.

```bash
stack_failures 01-iam
```

`AccessDenied` on `iam:CreateRole` means your user lacks IAM permissions. `AlreadyExists` means a
role with that name was made by hand (for example by the console guide `../aws/01-iam.md`).
Remove the hand-made role in the IAM console or CLI, or pick another `Environment`.

## Post-Deploy

No post-deploy configuration is needed for this stack.

## Verify

Check the stack status again.

```bash
stack_status 01-iam
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE`).

The two roles exist:

```bash
aws iam get-role --role-name ridenow-$ENV-eks-cluster-role \
  --query 'Role.[RoleName,Arn]' --output text
aws iam get-role --role-name ridenow-$ENV-eks-fargate-pod-execution-role \
  --query 'Role.[RoleName,Arn]' --output text
```

Expected: one line each, with an `arn:aws:iam::<account>:role/...` ARN.

The cluster role trusts EKS and the pod execution role trusts Fargate:

```bash
aws iam get-role --role-name ridenow-$ENV-eks-cluster-role \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Principal.Service' --output text
aws iam get-role --role-name ridenow-$ENV-eks-fargate-pod-execution-role \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Principal.Service' --output text
```

Expected: `eks.amazonaws.com`, then `eks-fargate-pods.amazonaws.com`.

AWS managed policies are attached to those roles:

```bash
aws iam list-attached-role-policies --role-name ridenow-$ENV-eks-cluster-role \
  --query 'AttachedPolicies[].PolicyName' --output text
aws iam list-attached-role-policies --role-name ridenow-$ENV-eks-fargate-pod-execution-role \
  --query 'AttachedPolicies[].PolicyName' --output text
```

Expected: five policies for the cluster role (`AmazonEKSClusterPolicy`, `AmazonEKSComputePolicy`, `AmazonEKSBlockStoragePolicyV2`, `AmazonEKSLoadBalancingPolicy`, `AmazonEKSNetworkingPolicy`), then `AmazonEKSFargatePodExecutionRolePolicy`.

The five customer-managed policies exist:

```bash
aws iam list-policies --scope Local \
  --query "Policies[?starts_with(PolicyName,'ridenow-$ENV-')].PolicyName" --output text | tr '\t' '\n'
```

Expected: `ridenow-prod-app-access` and the four `...-messaging` policies.

A messaging policy is scoped to one resource (example: the notification worker):

```bash
ARN=$(exp iam-NotificationWorkerMessagingPolicyArn)
VER=$(aws iam get-policy --policy-arn $ARN --query Policy.DefaultVersionId --output text)
aws iam get-policy-version --policy-arn $ARN --version-id $VER \
  --query 'PolicyVersion.Document.Statement[].[Action,Resource]' --output json
```

Expected: SQS actions and one `...:ridenow-prod-notifications` ARN. No `*` resource.

Seven exports for later stacks:

```bash
stack_outputs 01-iam
```

Expected: seven rows: `AppAccessPolicyArn`, `ClusterRoleArn`, `FargatePodExecutionRoleArn` and the four messaging
policy ARNs. Each is exported as `ridenow-prod-iam-<OutputKey>`, so `exp iam-ClusterRoleArn` returns the cluster role ARN.

Next: `02-network.md`.
