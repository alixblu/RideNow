# 03 - ECR: a registry for the service images

Goal: one ECR repository per service, then build each image and push it. Fargate
pulls from here using the **Fargate pod execution role** (it carries
`AmazonEKSFargatePodExecutionRolePolicy`, which includes ECR pull — from guide 01).

Time: ~20 min (mostly image builds). Cost: ECR storage is cheap; you pay per GB
stored and for data transfer.

---

## 1. Create the repositories (console)

Create one repo per service. Do this six times, once per name:

1. Console -> **ECR** -> **Repositories** -> **Create repository**.
2. Visibility: **Private**.
3. Repository name (type the full namespaced name):
   - `ridenow/user-service`
   - `ridenow/driver-service`
   - `ridenow/trip-service`
   - `ridenow/payment-service`
   - `ridenow/matching-service`
   - `ridenow/notification-worker`
4. **Image scan on push**: enable (free basic scanning; catches known CVEs).
5. **Encryption**: leave default (AES-256), or pick KMS.
6. **Create repository**. Repeat for each name.

> These names match the image references in the k8s manifests:
> `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/ridenow/<service>:<tag>`.

---

## 2. Build and push the images

There is a ready script for this: `../scripts/push-to-ecr.sh`. It authenticates
Docker to ECR, then builds/tags/pushes all six services (it already includes
`matching-service` and `notification-worker`). It is **dry-run by default**
(prints the commands) and only acts with `--push`.

Run it from the repo root:

```bash
# dry run first - read exactly what it will do (no changes):
AWS_ACCOUNT_ID=<your 12-digit id> AWS_REGION=ap-southeast-1 ./localfile/scripts/push-to-ecr.sh

# then push for real with a versioned tag (use an immutable tag in production,
# not a floating "local"):
IMAGE_TAG=v1.0.0 AWS_ACCOUNT_ID=<your 12-digit id> AWS_REGION=ap-southeast-1 \
  ./localfile/scripts/push-to-ecr.sh --push
```

What the script does per service: `docker build` the service folder, `docker tag`
it for ECR, `docker push`. The login token it uses is valid ~12h.

### Doing it by hand (if you prefer no script)

For one service, from its folder (e.g. `trip-service/`):

```bash
# 1. authenticate Docker to your registry (once per ~12h)
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com

# 2. build, tag, push (use an immutable version tag in production)
docker build -t trip-service:v1.0.0 ./trip-service
docker tag trip-service:v1.0.0 <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/trip-service:v1.0.0
docker push <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/trip-service:v1.0.0
```

---

## Verify

- ECR -> each `ridenow/<service>` repo shows at least one image tag (e.g.
  `v1.0.0`), with a scan result.

## Clean up

ECR storage is cheap. A lifecycle policy (expire untagged images, cap tag count)
keeps it bounded automatically — the `03-ecr.yaml` stack sets this up. Delete old
tags you no longer need (repo -> select images -> Delete).

Next: `04-rds-secrets.md`.
