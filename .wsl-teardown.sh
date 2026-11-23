#!/usr/bin/env bash
# Full prod teardown (user-approved option 1). Logs each phase.
set -uo pipefail
export AWS_PAGER="" AWS_DEFAULT_REGION=ap-southeast-1 AWS_REGION=ap-southeast-1
R=ap-southeast-1; E=prod
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[ "$ACCOUNT" = "873716897107" ] || { echo "unexpected account $ACCOUNT, abort"; exit 1; }

echo "== PHASE 1: in-cluster cleanup"
aws eks update-kubeconfig --name ridenow-$E --region $R >/dev/null
cd /mnt/d/GitRepo/RideNow/iac/scripts
echo prod | bash ./cleanup-cluster.sh $E --apply 2>&1 | grep -E '^--|skipped|Done|Aborted' 

echo "== PHASE 2: wait for the ALB and its target groups to go"
for i in $(seq 1 30); do
  n=$(aws elbv2 describe-load-balancers --query "length(LoadBalancers[?contains(LoadBalancerName,'k8s-ridenow')])" --output text)
  [ "$n" = "0" ] && break; sleep 10
done
echo "ALBs left: $n"
for tg in $(aws elbv2 describe-target-groups --query "TargetGroups[?starts_with(TargetGroupName,'k8s-ridenow')].TargetGroupArn" --output text); do
  aws elbv2 delete-target-group --target-group-arn $tg && echo "deleted leftover target group $tg"
done

echo "== PHASE 3: controller-created security groups left in the VPC"
VPC=$(aws cloudformation list-exports --query "Exports[?Name=='ridenow-$E-network-VpcId'].Value" --output text)
for i in $(seq 1 12); do
  sgs=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC Name=tag-key,Values=elbv2.k8s.aws/cluster --query 'SecurityGroups[].GroupId' --output text)
  [ -z "$sgs" ] && break
  for sg in $sgs; do aws ec2 delete-security-group --group-id $sg 2>/dev/null && echo "deleted $sg"; done
  sleep 10
done
echo "controller SGs left: ${sgs:-none}"

echo "== PHASE 4: detach the hand-attached ALB controller policy from the stack-07 role"
aws iam detach-role-policy --role-name ridenow-$E-alb-controller --policy-arn arn:aws:iam::$ACCOUNT:policy/AWSLoadBalancerControllerIAMPolicy && echo detached
aws iam list-attached-role-policies --role-name ridenow-$E-alb-controller --query 'AttachedPolicies[].PolicyName' --output text

echo "== PHASE 5: empty the ECR repositories (CloudFormation cannot delete non-empty repos)"
for repo in $(aws ecr describe-repositories --query "repositories[?starts_with(repositoryName,'ridenow/')].repositoryName" --output text); do
  ids=$(aws ecr list-images --repository-name $repo --query 'imageIds' --output json)
  cnt=$(echo "$ids" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
  if [ "$cnt" -gt 0 ]; then
    aws ecr batch-delete-image --repository-name $repo --image-ids "$ids" --query 'length(imageIds)' --output text | sed "s|^|$repo: deleted |"
  else echo "$repo: empty"; fi
done

echo "== PHASE 6: CloudFormation stacks 07 -> 01"
cd /mnt/d/GitRepo/RideNow/iac/scripts
echo prod | bash ./teardown.sh $E --apply 2>&1 | grep -E '^--|Done|Aborted|rror'

echo "== PHASE 7: verify"
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED DELETE_IN_PROGRESS ROLLBACK_COMPLETE REVIEW_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE \
  --query "StackSummaries[?contains(StackName,'ridenow-$E')].[StackName,StackStatus]" --output text
echo "== TEARDOWN SCRIPT DONE"
