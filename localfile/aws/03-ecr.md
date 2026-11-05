# 03 - ECR: a registry for the service images

Goal: one ECR repository per service, then build each image and push it. EKS
nodes pull from here (their node role already has `AmazonEC2ContainerRegistryReadOnly`
from guide 01).

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

# then push for real:
AWS_ACCOUNT_ID=<your 12-digit id> AWS_REGION=ap-southeast-1 ./localfile/scripts/push-to-ecr.sh --push

# optional: a versioned tag instead of "local"
IMAGE_TAG=v1.0.0 AWS_ACCOUNT_ID=... AWS_REGION=... ./localfile/scripts/push-to-ecr.sh --push
```

What the script does per service: `docker build` the service folder, `docker tag`
it for ECR, `docker push`. The login token it uses is valid ~12h.

### Doing it by hand (if you prefer no script)

For one service, from its folder (e.g. `trip-service/`):

```bash
# 1. authenticate Docker to your registry (once per ~12h)
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com

# 2. build, tag, push
docker build -t trip-service:local ./trip-service
docker tag trip-service:local <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/trip-service:local
docker push <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/trip-service:local
```

---

## Verify

- ECR -> each `ridenow/<service>` repo shows at least one image tag (`local` or
  your `IMAGE_TAG`), with a scan result.

## Clean up

ECR storage is cheap, but to avoid charges delete old image tags you don't need
(repo -> select images -> Delete), or delete the repos entirely if you abandon
the project.

Next: `04-rds-secrets.md`.
