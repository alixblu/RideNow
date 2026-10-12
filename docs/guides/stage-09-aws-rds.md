# Stage 9 - Managed database (RDS PostgreSQL)

> Part: PART 3 - AWS, CONSOLE FIRST
> Status: OUTLINE. Ask to expand this into full click-by-click detail when you reach it,
> so the steps are verified against the current tooling/console at that time.

## Outline of steps

- [ ] Console: create a small free-tier RDS PostgreSQL instance in the right subnets.
- [ ] Attach the Stage 8 security group; connect from your laptop with psql.
- [ ] Point a local driver-service at RDS and run the create/read loop.
- [ ] CloudFormation: write a template that recreates this RDS instance; deploy it.
- [ ] Delete the console-made instance; keep only the CloudFormation one.

## Definition of Done

- [ ] driver-service runs against RDS
- [ ] you can create and destroy the RDS instance from a CloudFormation template

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
