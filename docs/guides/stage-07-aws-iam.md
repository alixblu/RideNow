# Stage 7 - Account and identity (IAM)

> Part: PART 3 - AWS, CONSOLE FIRST
> Status: OUTLINE. Ask to expand this into full click-by-click detail when you reach it,
> so the steps are verified against the current tooling/console at that time.

## Outline of steps

- [ ] Create or secure an AWS account; enable MFA on the root user.
- [ ] Create an admin IAM user (or Identity Center user) for daily work; stop using root.
- [ ] Install the AWS CLI and run ws configure with the new user's keys.
- [ ] Console tour: IAM users, groups, roles, policies; the idea of least privilege.

## Definition of Done

- [ ] ws sts get-caller-identity works as a non-root user
- [ ] root user has MFA and is no longer used day-to-day

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
