# 03 - ECR (container registry)

Stack `ridenow-<env>-03-ecr` from `iac/stacks/03-ecr.yaml`. No dependencies.

## What it creates

Seven repositories: `ridenow/user-service`, `ridenow/driver-service`, `ridenow/trip-service`,
`ridenow/payment-service`, `ridenow/matching-service`, `ridenow/notification-worker`,
`ridenow/realtime-gateway`. Each has scan-on-push, KMS encryption and a lifecycle policy.

Repository names do **not** include the environment. Two environments in one account and region share
one set of repositories, so deploy this stack for only one of them.

The repositories start **empty**. Pushing images is `08-images.md`.

## Configure

```bash
params 03-ecr
```

Expected: `Environment=prod`, `MaxImageCount=50`, `UntaggedExpireDays=14`.

`MaxImageCount` is how many tagged images each repository keeps. `UntaggedExpireDays` is how long untagged
images stay. To change them once:

```bash
cfn_deploy 03-ecr MaxImageCount=20 UntaggedExpireDays=7
```

## Deploy

```bash
cfn_deploy 03-ecr
```

## Verify

```bash
stack_status 03-ecr
```

Expected: `CREATE_COMPLETE`.

Seven repositories, scan on push, KMS encryption:

```bash
aws ecr describe-repositories \
  --query "repositories[?starts_with(repositoryName,'ridenow/')].[repositoryName,imageScanningConfiguration.scanOnPush,encryptionConfiguration.encryptionType]" \
  --output table
```

Expected: seven rows, each `True` and `KMS`.

Lifecycle policy on one repository:

```bash
aws ecr get-lifecycle-policy --repository-name ridenow/user-service \
  --query lifecyclePolicyText --output text | jq '.rules[] | {rulePriority, description}'
```

Expected: two rules, one for untagged images and one for the tagged-image count.

The URIs later guides use:

```bash
aws cloudformation list-exports \
  --query "Exports[?starts_with(Name,'ridenow-$ENV-ecr-')].[Name,Value]" --output text
```

Expected: seven lines like `ridenow-prod-ecr-UserServiceRepoUri  <account>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/user-service`.

## If it fails

```bash
stack_failures 03-ecr
```

`already exists`: another stack (for example one for a different environment) owns the repositories.
Delete that stack, or skip this one and reuse its repositories.

Next: `04-rds.md`.