# 05 - Push images to ECR

Goal: build each service image and push it to the ECR repos (the four from the
CloudFormation `03-ecr` stack + the two you created by hand in step 01-04).

Time: ~20 min (image builds). This is the same as `../aws/03-ecr.md` section 2 -
only the repos were created differently (CFN vs console); pushing is identical.

---

## Use the ready script

`../scripts/push-to-ecr.sh` builds/tags/pushes all six services. It's dry-run by
default; `--push` acts.

```bash
# from the repo root
AWS_ACCOUNT_ID=873716897107 AWS_REGION=ap-southeast-1 ./localfile/scripts/push-to-ecr.sh          # dry run
AWS_ACCOUNT_ID=873716897107 AWS_REGION=ap-southeast-1 ./localfile/scripts/push-to-ecr.sh --push   # push
```

It targets `ridenow/<service>` repos, which is exactly what both the CFN `03-ecr`
stack and your two manual repos are named. Confirm with the CFN exports:

```bash
aws cloudformation list-exports \
  --region ap-southeast-1 \
  --query "Exports[?ends_with(Name,'RepoUri')].[Name,Value]" \
  --output table \
  --no-cli-pager

```

(The four `ridenow-dev-ecr-*RepoUri` exports + your two manual repos should all
read `...dkr.ecr.ap-southeast-1.amazonaws.com/ridenow/<service>`.)

---

## Verify

- ECR shows an image tag (`local` or your `IMAGE_TAG`) in all six repos.

Next: `06-eks-cluster.md`.
