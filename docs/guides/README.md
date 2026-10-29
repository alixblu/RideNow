# RideNow Step-by-Step Guides

Detailed walkthroughs for each stage of `../LEARNING_PATH.md`.

The learning path is the map (what and why, high level).
These guides are the turn-by-turn directions (every command, file, and click).

## How to use

1. Open `../LEARNING_PATH.md` and find the stage you are on.
2. Open the matching guide file here and follow it top to bottom.
3. Do not skip the "Verify" steps - they are how you know a step worked.
4. When a stage's Definition of Done passes, mark it `[x]` in the learning path.

## Companion docs (read these for the big picture)

- `../ARCHITECTURE.md` - the local-first mental model: stable boundaries, swappable mechanisms.
- `../PLAN_LOCAL_VS_CLOUD.md` - what service / what technique / what problem, local vs cloud,
  with diagrams and the full concurrency (accept-ride) explanation.

## Index

| Stage | Guide | Status |
|-------|-------|--------|
| 1 | (done interactively - see LEARNING_PATH Stage 1) | complete |
| 2 | `stage-02-driver-vehicles.md` | ready |
| 3 | `stage-03-user-service.md` | ready |
| 4 | `stage-04-service-to-service.md` | ready |
| 4A-4E | ride flow (trip, concurrency, matching, outbox, payment) | see `../PLAN_LOCAL_VS_CLOUD.md` + `../LEARNING_PATH.md` Part 1B |
| 11A | `stage-11a-local-async-messaging.md` - local SQS+EventBridge build (LocalStack) | complete |
| 5 | `stage-05-containerize.md` | complete (see `stage-05b-cloud-migration-prep.md`) |
| 6 | `stage-06-compose-system.md` | complete (see `stage-05b-cloud-migration-prep.md`) |
| 5b | `stage-05b-cloud-migration-prep.md` | complete (images, env config, ECR/RDS prep) |
| 7 | `stage-07-aws-iam.md` | outline |
  | 9 | `stage-09-aws-rds.md` | outline |
| 10 | `stage-10-aws-ecr.md` | outline |
| 11 | `stage-11-aws-redis-sqs-eventbridge.md` | outline |
| 12 | `stage-12-eks-first-pod.md` | outline |
| 13 | `stage-13-eks-hardening.md` | outline |

## Scope of these guides

Guides cover two kinds of hands-on work only:
- **Backend code build** (stages 2-4b): Java/Spring Boot code, build, and verify.
- **AWS Console configuration** (stages 7-13): click-by-click setup of the related AWS
  service, **console only**. Infrastructure-as-code (CloudFormation) is intentionally NOT
  in the guides - learn the console first; codify later as a separate exercise.

Stages 5-6 are local backend packaging (Docker build/run), not AWS.

## A note on the AWS/EKS outlines (stages 7-13)

These are intentionally left as outlines. The AWS Console UI and exact button labels
change over time, and the right steps depend on choices you make in earlier stages.
When you reach one of these stages, ask for it to be expanded into full click-by-click
console detail verified against the current console.

## Hands-on AWS console walkthrough (backend -> EKS)

A full click-by-click, console-first path to run the RideNow backend on EKS lives in
`../../localfile/aws/` (IAM -> VPC -> ECR -> RDS/Secrets -> EKS -> deploy, plus
ElastiCache and SQS/EventBridge as later ops). It is the console counterpart to the
CloudFormation in `../../iac/` and matches the services as built (ports, image names,
and the SQS/EventBridge/Redis env the code reads). Start at
`../../localfile/aws/README.md`.