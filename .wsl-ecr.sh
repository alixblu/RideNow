#!/usr/bin/env bash
export AWS_PAGER="" AWS_DEFAULT_REGION=ap-southeast-1 PATH="/home/alixblu/.local/bin:$PATH"
echo "== 03-ecr failure reasons"
aws cloudformation describe-stack-events --stack-name ridenow-prod-03-ecr \
  --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].[LogicalResourceId,ResourceStatusReason]" --output text | cut -c1-220 | head -10
echo "== images left per repo"
for repo in $(aws ecr describe-repositories --query "repositories[?starts_with(repositoryName,'ridenow/')].repositoryName" --output text); do
  echo "$repo: $(aws ecr describe-images --repository-name $repo --query 'length(imageDetails)' --output text) images, tags: $(aws ecr describe-images --repository-name $repo --query 'imageDetails[].imageTags' --output text | tr '\n' ' ')"
  aws ecr describe-images --repository-name $repo --query 'imageDetails[].imageManifestMediaType' --output text | tr '\t' '\n' | sort | uniq -c
done
