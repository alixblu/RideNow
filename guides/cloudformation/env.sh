#!/usr/bin/env bash
# Shared helpers for every guide in this folder.
# Run from the repo root:   source guides/cloudformation/env.sh
# Override before sourcing: ENV=dev AWS_DEFAULT_REGION=us-east-1 source guides/cloudformation/env.sh

export ENV="${ENV:-prod}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
export AWS_REGION="$AWS_DEFAULT_REGION"
export AWS_PAGER=""
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export STACKS="iac/stacks"
export PARAMS_FILE="iac/params/${ENV}.json"
export IMAGE_TAG="${IMAGE_TAG:-v1.0.0}"
# Browser origin of the frontend. Never "*". Change it before guide services/.
export APP_ORIGIN="${APP_ORIGIN:-https://app.example.com}"

# exp <Layer-Name>  ->  value of the CloudFormation export ridenow-$ENV-<Layer-Name>
# Example: exp network-VpcId
exp() {
  aws cloudformation list-exports \
    --query "Exports[?Name=='ridenow-${ENV}-$1'].Value" --output text
}

# params <layer>  ->  Key=Value lines from iac/params/$ENV.json (empty values skipped)
params() {
  jq -r --arg l "$1" '.[$l] // {} | to_entries[] | select(.value != "") | "\(.key)=\(.value)"' \
    "$PARAMS_FILE" | tr -d '\r'
}

# cfn_deploy <layer> [Key=Value ...]
# Creates/updates stack ridenow-$ENV-<layer> from iac/stacks/<layer>.yaml using the values
# in iac/params/$ENV.json. Extra Key=Value arguments override the file for this run only.
cfn_deploy() {
  local layer="$1"; shift
  local overrides=() kv e skip
  while IFS= read -r kv; do
    skip=0
    for e in "$@"; do [[ "${e%%=*}" == "${kv%%=*}" ]] && skip=1; done
    (( skip )) || overrides+=("$kv")
  done < <(params "$layer")
  aws cloudformation deploy \
    --template-file "${STACKS}/${layer}.yaml" \
    --stack-name "ridenow-${ENV}-${layer}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides "${overrides[@]}" "$@"
}

# stack_status <layer>  ->  CREATE_COMPLETE, UPDATE_COMPLETE, ROLLBACK_COMPLETE, ...
stack_status() {
  aws cloudformation describe-stacks --stack-name "ridenow-${ENV}-$1" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo DOES_NOT_EXIST
}

# stack_failures <layer>  ->  why a create/update failed (newest first)
stack_failures() {
  aws cloudformation describe-stack-events --stack-name "ridenow-${ENV}-$1" \
    --query "StackEvents[?contains(ResourceStatus,'FAILED')].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
    --output text | head -n 15
}

# stack_outputs <layer>  ->  the stack's outputs as a table
stack_outputs() {
  aws cloudformation describe-stacks --stack-name "ridenow-${ENV}-$1" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
}

# k8s_apply <manifest-name-without-.yaml>  e.g. k8s_apply 22-trip-service
# Fills every <PLACEHOLDER> in iac/k8s/<name>.yaml from stack exports, then kubectl apply.
k8s_apply() {
  sed -e "s|<ACCOUNT_ID>|${ACCOUNT_ID}|g" \
      -e "s|<REGION>|${AWS_DEFAULT_REGION}|g" \
      -e "s|<ENV>|${ENV}|g" \
      -e "s|<IMAGE_TAG>|${IMAGE_TAG}|g" \
      -e "s|<APP_ORIGIN>|${APP_ORIGIN}|g" \
      -e "s|<REDIS_ENDPOINT>|$(exp messaging-RedisPrimaryEndpoint)|g" \
      -e "s|<USER_DB_ENDPOINT>|$(exp data-UserDbEndpoint)|g" \
      -e "s|<DRIVER_DB_ENDPOINT>|$(exp data-DriverDbEndpoint)|g" \
      -e "s|<TRIP_DB_ENDPOINT>|$(exp data-TripDbEndpoint)|g" \
      -e "s|<PAYMENT_DB_ENDPOINT>|$(exp data-PaymentDbEndpoint)|g" \
      -e "s|<MATCHING_DB_ENDPOINT>|$(exp data-MatchingDbEndpoint)|g" \
      -e "s|<NOTIFICATION_DB_ENDPOINT>|$(exp data-NotificationDbEndpoint)|g" \
      -e "s|<MATCHING_QUEUE_URL>|$(exp messaging-MatchingQueueUrl)|g" \
      -e "s|<PAYMENT_QUEUE_URL>|$(exp messaging-PaymentQueueUrl)|g" \
      -e "s|<NOTIFICATIONS_QUEUE_URL>|$(exp messaging-NotificationQueueUrl)|g" \
      -e "s|<TRIP_SERVICE_ROLE_ARN>|$(exp eks-TripServiceRoleArn)|g" \
      -e "s|<PAYMENT_SERVICE_ROLE_ARN>|$(exp eks-PaymentServiceRoleArn)|g" \
      -e "s|<MATCHING_SERVICE_ROLE_ARN>|$(exp eks-MatchingServiceRoleArn)|g" \
      -e "s|<NOTIFICATION_WORKER_ROLE_ARN>|$(exp eks-NotificationWorkerRoleArn)|g" \
      "iac/k8s/$1.yaml" | kubectl apply -f -
}

echo "ENV=${ENV}  REGION=${AWS_DEFAULT_REGION}  ACCOUNT=${ACCOUNT_ID}"