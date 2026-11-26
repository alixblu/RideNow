# 08 - Frontend (S3, CloudFront, GitHub deploy role)

You create a private S3 bucket, a CloudFront distribution (site plus `/api/*` and `/live*` to the ALB) and an optional GitHub deploy role by hand in the Console, following `iac/stacks/08-frontend.yaml`. Region `ap-southeast-1`, Environment `prod`, values from `iac/params/prod.json` layer `08-frontend`. Do this after the ALB exists (Runbook, Phase 6).

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `SiteBucket` | S3 bucket | `ridenow-prod-frontend-<account id>-ap-southeast-1` (for this account `ridenow-prod-frontend-873716897107-ap-southeast-1`) |
| `SiteBucketPolicy` | S3 bucket policy | on the bucket above |
| `OriginAccessControl` | CloudFront origin access control | `ridenow-prod-frontend-oac` |
| `SpaRewriteFunction` | CloudFront function | `ridenow-prod-spa-rewrite` |
| `Distribution` | CloudFront distribution | comment `RideNow prod frontend` |
| `DeployRole` | IAM role | `ridenow-prod-frontend-deploy` (only if `GithubOidcProviderArn` is set; it is `""` in prod.json, so skip steps 6 and 7 unless you want GitHub publishing) |

## Depends on

The Template imports nothing. It needs running services:

| Value | Where it comes from | Used for |
|---|---|---|
| `ALB_DNS_NAME` | Discovery_Block (the ALB of the `ridenow` Ingress) | Origin `backend` |
| `ACCOUNT_ID`, `AWS_REGION` | Discovery_Block | Bucket name, ARNs |

Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws). Stop if `ALB_DNS_NAME` is `MISSING`.

## Create the resources

Order: bucket, OAC, function, distribution, bucket policy, then the optional OIDC provider and role.

### 1. S3 bucket (`SiteBucket`)

**Create the bucket**

1. Go to **S3 -> Buckets -> Create bucket**.
2. Set **Bucket type** to `General purpose`.
3. Set **Bucket name** to `ridenow-prod-frontend-873716897107-ap-southeast-1`.
4. Set **AWS Region** to `Asia Pacific (Singapore) ap-southeast-1`.
5. Under **Object Ownership**, pick `ACLs disabled (recommended)` (Bucket owner enforced).
6. Under **Block Public Access settings for this bucket**, tick **Block all public access** (all four boxes on).
7. Set **Bucket Versioning** to `Enable`.
8. Under **Default encryption**, pick `Server-side encryption with Amazon S3 managed keys (SSE-S3)`. Leave **Bucket Key** as is.
9. Choose **Create bucket**.

**Add the lifecycle rule**

1. Open the bucket, then the **Management** tab -> **Lifecycle rules** -> **Create lifecycle rule**.
2. Set **Lifecycle rule name** to `expire-old-versions`.
3. Under **Choose a rule scope**, pick **Apply to all objects in the bucket**.
4. Tick **I acknowledge that this rule will apply to all objects in the bucket**.
5. Under **Lifecycle rule actions**, tick **Permanently delete noncurrent versions of objects**.
6. Set **Days after objects become noncurrent** to `30`.
7. Choose **Create rule**.

Check: Permissions tab shows Block all public access On, Properties tab shows Versioning Enabled and SSE-S3, Management tab shows `expire-old-versions` Enabled.

### 2. Origin access control (`OriginAccessControl`)

1. Go to **CloudFront -> Security -> Origin access -> Create control setting**.
2. Set **Name** to `ridenow-prod-frontend-oac`.
3. Leave **Description** empty.
4. Set **Origin type** to `S3`.
5. Set **Signing behavior** to `Sign requests (recommended)`.
6. Choose **Create**.

### 3. SPA rewrite function (`SpaRewriteFunction`)

1. Go to **CloudFront -> Functions -> Create function**.
2. Set **Name** to `ridenow-prod-spa-rewrite`.
3. Set **Description** to `Rewrite extensionless paths to /index.html for the SPA router`.
4. Set **Runtime** to `cloudfront-js-2.0`.
5. Choose **Create function**.
6. On the **Build** tab, in **Function code**, select all, delete, and paste the code below.
7. Choose **Save changes**.
8. Open the **Publish** tab and choose **Publish function**.

```javascript
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
```

Note: the Template auto-publishes; in the Console you must publish, or the distribution cannot attach the function.

### 4. CloudFront distribution (`Distribution`)

**Create the distribution**

1. Go to **CloudFront -> Distributions -> Create distribution**.
2. Under **Choose a plan**, pick `Pay as you go` (the Template has no flat-rate plan).
3. Set **Distribution name** to `ridenow-prod-frontend-cdn`.
4. Set **Distribution type** to `Single website or app`, then choose **Next**.
5. Set **Origin type** to `Amazon S3`.
6. For **S3 origin**, choose **Browse S3** and pick `ridenow-prod-frontend-873716897107-ap-southeast-1` (the bucket, not the website endpoint).
7. Under **Origin settings**, keep `Use recommended origin settings`. The wizard creates an origin access control for you. Choose **Next**.
8. Under **Enable security**, do not enable AWS WAF protections. Choose **Next**.
9. On the review page, choose **Create distribution**.

The wizard creates its own OAC and may rewrite the bucket policy. Fix both below. Deployment takes 5 to 10 minutes; edit while it deploys.

**Fix the S3 origin**

1. Open the distribution, then the **Origins** tab. Select the S3 origin and choose **Edit**.
2. Set **Name** to `site`.
3. Set **Origin access** to `Origin access control settings (recommended)`.
4. Set **Origin access control** to `ridenow-prod-frontend-oac` (from step 2).
5. Choose **Save changes**.
6. If the wizard-made OAC is now unused, leave it. You can delete it later under **Origin access**.

**Add the ALB origin**

1. On the **Origins** tab, choose **Create origin**.
2. Set **Origin domain** to the value of `ALB_DNS_NAME` (plain DNS name, no `http://`, no path).
3. Set **Protocol** to `HTTP only`.
4. Set **HTTP port** to `80`.
5. Set **Name** to `backend`.
6. Set **Origin access** to `Public`.
7. Under **Additional settings**, set **Response timeout** to `60`.
8. Set **Keep-alive timeout** to `60`.
9. Choose **Create origin**.

**Edit the default behavior**

1. Open the **Behaviors** tab, select **Default (*)**, and choose **Edit**.
2. Set **Origin and origin groups** to `site`.
3. Set **Compress objects automatically** to `Yes`.
4. Set **Viewer protocol policy** to `Redirect HTTP to HTTPS`.
5. Set **Allowed HTTP methods** to `GET, HEAD, OPTIONS`.
6. Set **Cache HTTP methods** to `GET, HEAD` only (leave OPTIONS unticked).
7. Under **Cache key and origin requests**, set **Cache policy** to `CachingOptimized` (Managed, id `658327ea-f89d-4fab-a63d-7e88639e58f6`).
8. Leave **Origin request policy** empty.
9. Under **Function associations**, set **Viewer request** to **Function type** `CloudFront Functions` and **Function ARN / name** `ridenow-prod-spa-rewrite`.
10. Leave all other function associations empty.
11. Choose **Save changes**.

**Create the `/api/*` behavior**

1. On the **Behaviors** tab, choose **Create behavior**.
2. Set **Path pattern** to `/api/*`.
3. Set **Origin and origin groups** to `backend`.
4. Set **Compress objects automatically** to `No`.
5. Set **Viewer protocol policy** to `Redirect HTTP to HTTPS`.
6. Set **Allowed HTTP methods** to `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`.
7. Set **Cache HTTP methods** to `GET, HEAD` only.
8. Set **Cache policy** to `CachingDisabled` (Managed, id `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`).
9. Set **Origin request policy** to `AllViewerExceptHostHeader` (Managed, id `b689b0a8-53d0-40ab-baf2-68738e2966ac`).
10. Leave **Function associations** empty.
11. Choose **Create behavior**.

**Create the `/live*` behavior** (server-sent events from realtime-gateway)

1. On the **Behaviors** tab, choose **Create behavior**.
2. Set **Path pattern** to `/live*`.
3. Set **Origin and origin groups** to `backend`.
4. Set **Compress objects automatically** to `No`.
5. Set **Viewer protocol policy** to `Redirect HTTP to HTTPS`.
6. Set **Allowed HTTP methods** to `GET, HEAD, OPTIONS`.
7. Set **Cache HTTP methods** to `GET, HEAD` only.
8. Set **Cache policy** to `CachingDisabled`.
9. Set **Origin request policy** to `AllViewerExceptHostHeader`.
10. Leave **Function associations** empty.
11. Choose **Create behavior**.
12. Check the order in the **Behaviors** list: `/api/*` first, `/live*` second, **Default (*)** last.

**Edit the general settings**

1. Open the **General** tab, then **Settings -> Edit**.
2. Set **Description** to `RideNow prod frontend`.
3. Set **Price class** to `Use only North America and Europe`.
4. Set **Supported HTTP versions** to `HTTP/2` and `HTTP/3` (tick both).
5. Set **IPv6** to `On`.
6. Set **Default root object** to `index.html`.
7. Set **Standard logging** to `Off`.
8. Leave **AWS WAF web ACL** empty.
9. Set **Distribution state** to `Enabled`.
10. Choose **Save changes**.
11. Leave the **Error pages** tab empty. The Template has no custom error responses, because the function handles SPA routes.

Check: General tab shows the **Distribution domain name** (`d....cloudfront.net`) and **ID** (`E...`). Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws) again so `CLOUDFRONT_ID` and `CLOUDFRONT_DOMAIN` are set.

### 5. Bucket policy (`SiteBucketPolicy`)

1. Go to **S3 -> Buckets** and open `ridenow-prod-frontend-873716897107-ap-southeast-1`.
2. Open the **Permissions** tab, then **Bucket policy -> Edit**.
3. Select all, delete, and paste the JSON below. Replace `<CLOUDFRONT_ID>` with the distribution ID from step 4.
4. Choose **Save changes**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontRead",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::ridenow-prod-frontend-873716897107-ap-southeast-1/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::873716897107:distribution/<CLOUDFRONT_ID>"
        }
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::ridenow-prod-frontend-873716897107-ap-southeast-1",
        "arn:aws:s3:::ridenow-prod-frontend-873716897107-ap-southeast-1/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }
  ]
}
```

### 6. GitHub OIDC provider (optional, only for GitHub publishing)

1. Go to **IAM -> Identity providers**. If `token.actions.githubusercontent.com` is already listed, copy its ARN and skip to step 7.
2. Choose **Add provider**.
3. Set **Provider type** to `OpenID Connect`.
4. Set **Provider URL** to `https://token.actions.githubusercontent.com`. Choose **Get thumbprint** if shown.
5. Set **Audience** to `sts.amazonaws.com`.
6. Choose **Add provider**.
7. Copy the ARN `arn:aws:iam::873716897107:oidc-provider/token.actions.githubusercontent.com`. This is `GithubOidcProviderArn`.

### 7. Deploy role (`DeployRole`, optional)

**Create the role**

1. Go to **IAM -> Roles -> Create role**.
2. Set **Trusted entity type** to `Custom trust policy`.
3. Paste the trust policy JSON below. Replace the `Federated` ARN if you reused another provider. Choose **Next**.
4. On **Add permissions**, select nothing. Choose **Next**.
5. Set **Role name** to `ridenow-prod-frontend-deploy`.
6. Set **Description** to `Assumed by GitHub Actions (OIDC) to publish the RideNow frontend.`
7. Choose **Create role**.

**Add the inline policy**

1. Open the role, then the **Permissions** tab -> **Add permissions -> Create inline policy** -> **JSON**.
2. Paste the permissions JSON below. Replace `<CLOUDFRONT_ID>`. Choose **Next**.
3. Set **Policy name** to `publish-frontend`.
4. Choose **Create policy**.

**Set the session length**

1. On the role **Summary**, choose **Maximum session duration -> Edit**.
2. Set it to `1 hour`.
3. Choose **Save changes**.

Trust policy (`sub` is `repo:` + GithubRepo + `:environment:` + Environment):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::873716897107:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:alixblu/RideNow:environment:prod"
        }
      }
    }
  ]
}
```

Permissions policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::ridenow-prod-frontend-873716897107-ap-southeast-1"
    },
    {
      "Sid": "WriteObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::ridenow-prod-frontend-873716897107-ap-southeast-1/*"
    },
    {
      "Sid": "Invalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::873716897107:distribution/<CLOUDFRONT_ID>"
    },
    {
      "Sid": "ReadStackOutputs",
      "Effect": "Allow",
      "Action": "cloudformation:DescribeStacks",
      "Resource": "arn:aws:cloudformation:ap-southeast-1:873716897107:stack/ridenow-prod-08-frontend/*"
    }
  ]
}
```

Note: `ReadStackOutputs` is copied from the Template and grants access to nothing, because no stack exists.

## Values to record

| Output in the Template | Where to read it | Variable | Consumed by |
|---|---|---|---|
| `BucketName` | S3 -> Buckets | `BUCKET` (set in Post-Deploy) | Post-Deploy, Rollback, Teardown |
| `DistributionId` | CloudFront -> Distributions -> ID | `CLOUDFRONT_ID` | Steps 5 and 7, Post-Deploy, Rollback |
| `DistributionDomain` | CloudFront -> Distributions -> Domain name | `CLOUDFRONT_DOMAIN` | Post-Deploy, Verify |
| `DeployRoleArn` (only if the role exists) | IAM -> Roles -> `ridenow-prod-frontend-deploy` -> ARN | `DEPLOY_ROLE_ARN` | GitHub variable `AWS_DEPLOY_ROLE_ARN` |

Empty values in `iac/params/prod.json`: `AlbDnsName` is `""`, take it from `ALB_DNS_NAME` (Discovery_Block) for origin `backend`. `GithubOidcProviderArn` is `""`, which skips `DeployRole`; use the ARN from step 6 to create it.

## Post-Deploy

Set the bucket name once per terminal, after the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws):

```bash
BUCKET="ridenow-$ENV-frontend-$ACCOUNT_ID-$AWS_REGION"
echo "$BUCKET  $CLOUDFRONT_ID  $CLOUDFRONT_DOMAIN"
```

### A. First publish

Build with the CloudFront domain as API base, upload `assets/*` immutable and the rest `no-cache`, invalidate `/index.html`:

```bash
( cd frontend && pnpm install --frozen-lockfile && VITE_API_BASE_URL="https://$CLOUDFRONT_DOMAIN" pnpm build )
aws s3 sync frontend/dist/ "s3://$BUCKET/" \
  --exclude "*" --include "assets/*" \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync frontend/dist/ "s3://$BUCKET/" \
  --exclude "assets/*" \
  --cache-control "no-cache" \
  --delete
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/index.html" \
  --query 'Invalidation.[Id,Status]' --output text
```

Note: the stack-era `iac/scripts/publish-frontend.sh` still reads CloudFormation outputs, so use the commands above.

### B. GitHub setup (only if you created the deploy role)

```bash
REVIEWER_ID=$(gh api user --jq .id)
jq -n --argjson id "$REVIEWER_ID" '{reviewers: [{type: "User", id: $id}]}' \
  | gh api -X PUT "repos/$GITHUB_REPO/environments/prod" --input - --jq '.name'
gh variable set AWS_DEPLOY_ROLE_ARN --env prod --repo "$GITHUB_REPO" --body "$DEPLOY_ROLE_ARN"
gh variable set AWS_REGION --env prod --repo "$GITHUB_REPO" --body "$AWS_REGION"
gh variable list --env prod --repo "$GITHUB_REPO"
```

Note: required reviewers need a public repository or a paid plan. The workflow job must run in the GitHub Environment `prod`. The workflow calls the script above, so a workflow publish fails until it stops reading stack outputs.

## Verify

Load the variables with the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws), then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://$CLOUDFRONT_DOMAIN/"
```

Expected: `200`. `403` means the bucket is empty (run part A) or the bucket policy names another distribution. `000` means the distribution is still Deploying.

## Rollback

The bucket is versioned. The assets in `assets/*` are never deleted by a publish, so a rollback only needs to restore `index.html`.

List the versions of `index.html`, newest first:

```bash
aws s3api list-object-versions --bucket "$BUCKET" --prefix index.html \
  --query "Versions[?Key=='index.html'].[VersionId,LastModified,IsLatest]" --output table
```

Pick the version id to restore (the second row is the previous release), and copy it over the current object. The copy keeps the `no-cache` header:

```bash
PREV=$(aws s3api list-object-versions --bucket "$BUCKET" --prefix index.html \
  --query "Versions[?Key=='index.html'].VersionId | [1]" --output text)
aws s3api copy-object --bucket "$BUCKET" --key index.html \
  --copy-source "$BUCKET/index.html?versionId=$PREV" \
  --query 'VersionId' --output text
```

Expected: a new version id. Invalidate the CloudFront cache so viewers get it:

```bash
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/index.html" \
  --query 'Invalidation.[Id,Status]' --output text
```

Expected: `I...  InProgress`. Re-check the root path (Verify).

Noncurrent versions expire after 30 days. To roll back further than that, check out the older commit and repeat Post-Deploy, part A.

## Teardown

Run this only when you remove the whole frontend. Delete in this order, each in its own console:

1. **IAM** > Roles > `ridenow-prod-frontend-deploy` > **Delete** (only if you created it).
2. **CloudFront** > Distributions > select the distribution > **Disable**, wait until Last modified shows a date, then **Delete**.
3. **CloudFront** > Functions > `ridenow-prod-spa-rewrite` > **Delete**. It fails while a distribution still uses it.
4. **CloudFront** > Origin access > `ridenow-prod-frontend-oac` > **Delete**.
5. **S3** > Buckets > select the bucket > **Empty** (this removes all versions and delete markers), then **Delete**.

Result: none of the five resources is listed any more. The bucket must be empty first, or the delete fails with `BucketNotEmpty`.

The GitHub OIDC provider is account-level and shared. Delete it (**IAM** > Identity providers) only if nothing else in the account uses it. The GitHub Environment `prod` and its variables also stay. Remove them with `gh api -X DELETE "repos/$GITHUB_REPO/environments/prod"` if you no longer deploy.

## Follow-ups

- Custom domain: request an ACM certificate in `us-east-1`, add the domain as an alias on the distribution and point a Route 53 alias record at it. The site currently uses `*.cloudfront.net`.
- AWS WAF: attach a web ACL (scope `CLOUDFRONT`, created in `us-east-1`) to the distribution, with managed rule groups and a rate-based rule for `/api/*`.
- Restrict the ALB to CloudFront: the ALB is still reachable directly over HTTP. Limit its security group to the CloudFront origin-facing managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`), and add a custom origin header that the ALB checks.
- Old assets: the publish never deletes from `assets/`, so they accumulate slowly. Prune them by hand if size matters.

## Troubleshooting

### Credentials could not be loaded (GitHub Actions)

The step `aws-actions/configure-aws-credentials` fails with `Credentials could not be loaded`. The cause is an empty `role-to-assume`: `vars.AWS_DEPLOY_ROLE_ARN` is empty in the job. The environment named in the workflow must exactly equal the GitHub Environment that holds the variables. Compare them:

```bash
gh variable list --env prod --repo "$GITHUB_REPO"
grep -n 'environment:' .github/workflows/frontend-deploy.yml
```

Expected: the variable list shows `AWS_DEPLOY_ROLE_ARN`, and the workflow line resolves to `prod` (same spelling, same case). If the variables were set on the repository or on another environment, set them again with `--env prod`.

### Not authorized to perform sts:AssumeRoleWithWebIdentity

The role ARN is set but the assume call is rejected. Check the three things the trust policy compares:

```bash
aws iam get-role --role-name ridenow-prod-frontend-deploy \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals' --output json
```

Expected: `token.actions.githubusercontent.com:aud` is `sts.amazonaws.com` and `token.actions.githubusercontent.com:sub` is exactly `repo:alixblu/RideNow:environment:prod`. A job without `environment: prod` sends `repo:alixblu/RideNow:ref:refs/heads/main` instead and is rejected. The workflow also needs `permissions: id-token: write` (already set). Check that the role ARN in the variable equals `$DEPLOY_ROLE_ARN` and that the provider exists:

```bash
aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[].Arn" --output text
```

### The workflow does not wait for approval

The `prod` environment has no required reviewers. This happens on a private repository with the free plan. Make the repository public or upgrade the plan, then run the `gh api -X PUT` command in Post-Deploy part B again and check `reviewers: 1`.

### CloudFront returns 403

`AccessDenied` XML from a path that should exist. Check, in this order:

1. The object exists: `aws s3 ls "s3://$BUCKET/index.html"`. An empty bucket gives 403, not 404, because the bucket policy does not grant `s3:ListBucket`. Run the first publish.
2. The bucket policy names this distribution:

```bash
aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text \
  | jq -r '.Statement[] | select(.Sid=="AllowCloudFrontRead") | .Condition.StringEquals["AWS:SourceArn"]'
```

Expected: `arn:aws:cloudfront::873716897107:distribution/<CLOUDFRONT_ID>`. If the id differs (for example after you recreated the distribution), edit the policy again as in step 5.

3. The site was served over the S3 website endpoint or a direct bucket URL. Use only `https://$CLOUDFRONT_DOMAIN`.

### /api returns HTML

CloudFront served `index.html` for an API path, or the browser still calls localhost. The first means the `/api/*` behavior is missing:

```bash
aws cloudfront get-distribution-config --id "$CLOUDFRONT_ID" \
  --query 'DistributionConfig.CacheBehaviors.Items[].PathPattern'
```

Expected: `["/api/*", "/live*"]`. The second means the build ran without `VITE_API_BASE_URL`: rebuild as in Post-Deploy part A, not with a plain `pnpm build`.

### /api returns 502 or 504

CloudFront cannot reach the ALB. The ALB hostname changed (for example after the Ingress was recreated). Run the Discovery_Block, then open **CloudFront** > the distribution > **Origins** > `backend` > **Edit** and set **Origin domain** to the new `ALB_DNS_NAME`. Wait until Last modified shows a date.

### Old page after a publish

The browser or CloudFront still has the previous `index.html`. The publish invalidates `/index.html` only. Check that the invalidation finished:

```bash
aws cloudfront list-invalidations --distribution-id "$CLOUDFRONT_ID" --query 'InvalidationList.Items[0].[Id,Status]' --output text
```

Expected: `I...  Completed`.

Next: this guide completes the deployment. Return to `README.md` for the index.
