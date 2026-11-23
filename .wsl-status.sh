#!/usr/bin/env bash
export AWS_PAGER="" AWS_DEFAULT_REGION=ap-southeast-1 PATH="/home/alixblu/.local/bin:$PATH"
aws cloudformation list-stacks --query "StackSummaries[?contains(StackName,'ridenow-prod') && StackStatus!='DELETE_COMPLETE'].[StackName,StackStatus]" --output text | sort
