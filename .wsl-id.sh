#!/usr/bin/env bash
export AWS_PAGER="" AWS_DEFAULT_REGION=ap-southeast-1 PATH="/home/alixblu/.local/bin:$PATH"
timeout 25 aws sts get-caller-identity --cli-connect-timeout 10 --cli-read-timeout 10 < /dev/null 2>&1 | head -8
echo "exit=${PIPESTATUS[0]}"
