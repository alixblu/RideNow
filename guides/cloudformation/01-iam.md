# 01 - IAM

Stack `ridenow-<env>-01-iam` from `iac/stacks/01-iam.yaml`. No dependencies.

## What it creates

| Resource | Name | Used by |
|----------|------|---------|
| EKS cluster role | `ridenow-<env>-eks-cluster-role` | stack 06 (control plane) |
| Fargate pod execution role | `ridenow-<env>-eks-fargate-pod-execution-role` | stack 06 (pulls images, ships logs) |
| Managed policy | `ridenow-<env>-app-access` | applications |
| Messaging policies | `ridenow-<env>-{trip-service,payment-service,matching-service,notification-worker}-messaging` | stack 07 attaches each to its service role |

Each messaging policy names the exact topic or queue its service uses, so for example the
notification worker cannot read the payment queue.

## Configure

The only parameter is `Environment`.

```bash
params 01-iam
```

Expected: `Environment=prod`.

## Deploy

```bash
cfn_deploy 01-iam
```

Expected last line: `Successfully created/updated stack - ridenow-prod-01-iam`.

## Verify

Stack status:

```bash
stack_status 01-iam
```

Expected: `CREATE_COMPLETE`.

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
aws cloudformation list-exports \
  --query "Exports[?starts_with(Name,'ridenow-$ENV-iam-')].Name" --output text | tr '\t' '\n' | sort
```

Expected: `AppAccessPolicyArn`, `ClusterRoleArn`, `FargatePodExecutionRoleArn` and the four messaging
policy ARNs, all prefixed `ridenow-prod-iam-`.

## If it fails

```bash
stack_failures 01-iam
```

`AccessDenied` on `iam:CreateRole` means your user lacks IAM permissions. `AlreadyExists` means a
role with that name was made by hand (for example by the console guide `../aws/01-iam.md`).
Delete the hand-made role or pick another `Environment`.

Next: `02-vpc.md`.