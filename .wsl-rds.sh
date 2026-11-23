#!/usr/bin/env bash
export AWS_PAGER="" AWS_DEFAULT_REGION=ap-southeast-1 PATH="/home/alixblu/.local/bin:$PATH"
aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output text
aws cloudformation describe-stack-events --stack-name ridenow-prod-04-data --query 'StackEvents[0:4].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output text | cut -c1-200
