# 03 - ECR (container registry)

Stack `ridenow-<env>-03-ecr` from `iac/stacks/03-ecr.yaml`. Depends on: none.

## What it creates

Seven repositories: `ridenow/user-service`, `ridenow/driver-service`, `ridenow/trip-service`,
`ridenow/payment-service`, `ridenow/matching-service`, `ridenow/notification-worker`,
`ridenow/realtime-gateway`. Each has scan-on-push, KMS encryption, immutable tags and a lifecycle policy.

Repository names do **not** include the environment. Two environments in one account and region share
one set of repositories, so deploy this stack for only one of them.

The repositories start **empty**. The Post-Deploy section builds and pushes the images.

## Deploy

### Configure

Show the values this stack will use for the current environment:

```bash
params 03-ecr
```

Expected: `Environment=prod`, `MaxImageCount=50`, `UntaggedExpireDays=14`.

`MaxImageCount` is how many tagged images each repository keeps. `UntaggedExpireDays` is how long untagged
images stay. To change them for one run, pass overrides to `cfn_deploy` (this is the only place they are set):

```bash
cfn_deploy 03-ecr MaxImageCount=20 UntaggedExpireDays=7
```

### Run

Create or update the stack from `iac/stacks/03-ecr.yaml`:

```bash
cfn_deploy 03-ecr
```

Check the stack status:

```bash
stack_status 03-ecr
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a re-run).

### If it fails

Print the newest failure reasons:

```bash
stack_failures 03-ecr
```

`already exists`: another stack (for example one for a different environment) owns the repositories.
Reuse its repositories and skip this stack, or remove that stack outside this guide and deploy again.

## Post-Deploy

### Build and push images

Log Docker in to ECR. The token lasts about 12 hours. `ACCOUNT_ID`, `AWS_DEFAULT_REGION` and `IMAGE_TAG`
come from `env.sh` (`IMAGE_TAG` defaults to `v1.0.0`):

```bash
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
```

Build each of the seven service images and push it in one step. Run this from the repository root, where
each service directory holds its `Dockerfile`:

```bash
for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  docker buildx build --platform linux/amd64 \
    -t "$REGISTRY/ridenow/$SVC:$IMAGE_TAG" \
    --push "./$SVC"
done
```

Expected: seven successful builds, each ending with `pushing manifest ... done`.

This differs from `guides/scripts/push-to-ecr.sh`, which runs `docker build`, `docker tag` and `docker push`
with no platform flag. EKS Fargate runs `linux/amd64`, so an image built on an Arm machine (for example
Apple Silicon) would fail to start. `--platform linux/amd64` forces the right architecture, and `--push`
sends the image straight to ECR without keeping a local copy.

Tags are immutable (`ImageTagMutability: IMMUTABLE`). Pushing a tag that already exists fails with
`tag invalid`. To publish new code, set a new tag first, for example `export IMAGE_TAG=v1.0.1`, and run the
loop again. Use the same `IMAGE_TAG` in later guides, because `k8s_apply` writes it into the manifests.

## Verify

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

The pushed image exists in every repository. `deploy-and-test.sh` runs the same check before it deploys
any service:

```bash
for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  aws ecr describe-images --repository-name "ridenow/$SVC" \
    --image-ids "imageTag=$IMAGE_TAG" \
    --query 'imageDetails[0].[imageTags[0],imagePushedAt]' --output text \
    || echo "MISSING: ridenow/$SVC:$IMAGE_TAG"
done
```

Expected: seven lines, each the tag (for example `v1.0.0`) and a push timestamp, and no `MISSING` line.

The repository URIs later guides use:

```bash
stack_outputs 03-ecr
```

Expected: seven rows `<Service>RepoUri` with values like `<account>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/user-service`.

## Final check

Run this once the whole deployment is finished. It only reads. The image tag check in all seven repositories is already in Verify above, so only the stack status is repeated here.

```bash
stack_status 03-ecr
```

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

Next: `04-data.md`.
