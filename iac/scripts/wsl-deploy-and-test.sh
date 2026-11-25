#!/usr/bin/env bash
#
# wsl-deploy-and-test.sh - run deploy-and-test.sh from Windows through WSL.
#
# Calling `wsl.exe bash -c "..."` from PowerShell mangles `$PATH` and quotes, so this
# wrapper sets the environment inside WSL and passes every argument through unchanged.
#
#   wsl.exe bash iac/scripts/wsl-deploy-and-test.sh prod --tag v1.0.0 --yes
#
# Set RIDENOW_AWS_BIN if the AWS CLI is not in ~/.local/bin.
#
set -euo pipefail
export PATH="${RIDENOW_AWS_BIN:-$HOME/.local/bin}:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec bash iac/scripts/deploy-and-test.sh "$@"
