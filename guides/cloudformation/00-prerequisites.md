# 00 - Prerequisites

Run the guides in bash: WSL, Git Bash or Linux/macOS. PowerShell will not run the
`$(...)` and `for` syntax used here.

## 1. Tools

```bash
aws --version        # AWS CLI v2
jq --version
docker --version
kubectl version --client
helm version --short
```

Expected: each prints a version. AWS CLI must be v2 (`aws-cli/2.x`).

## 2. AWS credentials

Use a non-root IAM user or role with permission to create IAM, VPC, RDS, EKS, ECR,
SNS, SQS, ElastiCache, KMS and Secrets Manager resources.

```bash
aws configure set region ap-southeast-1
aws sts get-caller-identity
```

Expected: JSON with your `Account` and an `Arn` that is not `:root`.

```bash
aws sts get-caller-identity --query Arn --output text | grep -q ':root' \
  && echo "STOP: you are root" || echo "OK: not root"
```

## 3. Load the helpers

From the repo root:

```bash
cd /path/to/RideNow
source guides/cloudformation/env.sh
```

Expected: `ENV=prod  REGION=ap-southeast-1  ACCOUNT=<12 digits>`.

For another environment, set it first: `ENV=dev source guides/cloudformation/env.sh`. This
reads `iac/params/dev.json`, and every stack name becomes `ridenow-dev-...`.

## 4. Check the templates (no AWS changes)

```bash
for f in iac/stacks/*.yaml; do
  aws cloudformation validate-template --template-body "file://$f" >/dev/null \
    && echo "OK   $f" || echo "FAIL $f"
done
./iac/scripts/check-consistency.sh
```

Expected: seven `OK` lines and no errors from the consistency script.

## 5. Look at the parameters you are about to use

```bash
jq . "$PARAMS_FILE"
```

Edit `iac/params/$ENV.json` to change a value for every later run, or pass `Key=Value` to
`cfn_deploy` to change it once.

## 6. Check the account has not already got these stacks

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE \
  --query "StackSummaries[?starts_with(StackName,'ridenow-$ENV-')].[StackName,StackStatus]" \
  --output table
```

An empty result means a fresh start. Existing rows are fine: a deploy updates them.