# Stage 12 - A cluster and your first Pod

> Part: PART 4 - KUBERNETES ON EKS
> Status: OUTLINE. Ask to expand this into full click-by-click console detail when you
> reach it, so the steps are verified against the current console at that time.
> Guides cover CONSOLE configuration only.

## Outline of steps

- [ ] Console: create an EKS cluster with the smallest viable node group.
- [ ] Install kubectl; connect to the cluster.
- [ ] Deploy driver-service as a Deployment + Service pulling its image from ECR.
- [ ] Add readiness/liveness probes using the actuator health endpoint.

## Definition of Done

- [ ] driver-service runs in a Pod on EKS and serves traffic inside the cluster
- [ ] probes correctly report readiness and liveness

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
