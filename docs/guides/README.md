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
| 5 | `stage-05-containerize.md` | outline (expand when you reach it) |
| 6 | `stage-06-compose-system.md` | outline |
| 7 | `stage-07-aws-iam.md` | outline |
| 8 | `stage-08-aws-vpc.md` | outline |
| 9 | `stage-09-aws-rds.md` | outline |
| 10 | `stage-10-aws-ecr.md` | outline |
| 11 | `stage-11-aws-redis-sqs-eventbridge.md` | outline |
| 12 | `stage-12-eks-first-pod.md` | outline |
| 13 | `stage-13-eks-hardening.md` | outline |

## A note on the AWS/EKS outlines (stages 7-13)

These are intentionally left as outlines. The AWS Console UI and exact button labels
change over time, and the right steps depend on choices you make in earlier stages.
When you reach one of these stages, ask for it to be expanded into full click-by-click
detail verified against the current console. Writing them in exhaustive detail now would
risk them being wrong by the time you use them.