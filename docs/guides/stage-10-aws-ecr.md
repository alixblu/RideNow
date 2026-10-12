# Stage 10 - Image registry (ECR)

> Part: PART 3 - AWS, CONSOLE FIRST
> Status: OUTLINE. Ask to expand this into full click-by-click detail when you reach it,
> so the steps are verified against the current tooling/console at that time.

## Outline of steps

- [ ] Console: create an ECR repository for driver-service.
- [ ] Authenticate Docker to ECR; tag and push the Stage 5 image.
- [ ] CloudFormation: define the ECR repository as code.

## Definition of Done

- [ ] your driver-service image is in ECR and pullable
- [ ] the ECR repo is defined in a CloudFormation template

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
