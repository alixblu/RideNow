# Stage 13 - Routing, config, scaling, hardening

> Part: PART 4 - KUBERNETES ON EKS
> Status: OUTLINE. Ask to expand this into full click-by-click console detail when you
> reach it, so the steps are verified against the current console at that time.
> Guides cover CONSOLE configuration only.

## Outline of steps

- [ ] Ingress/ALB to route external HTTP to the service.
- [ ] ConfigMap for non-secret config; Secret (or Secrets Manager) for credentials.
- [ ] Horizontal Pod Autoscaler driven by CPU/metrics.
- [ ] Resource requests/limits on every container.

## Definition of Done

- [ ] the service scales under load and recovers failed Pods

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
