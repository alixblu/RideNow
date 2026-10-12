# Stage 13 - Routing, config, scaling, hardening

> Part: PART 4 - KUBERNETES ON EKS
> Status: OUTLINE. Ask to expand this into full click-by-click detail when you reach it,
> so the steps are verified against the current tooling/console at that time.

## Outline of steps

- [ ] Ingress/ALB to route external HTTP to the service.
- [ ] ConfigMap for non-secret config; Secret (or Secrets Manager) for credentials.
- [ ] Horizontal Pod Autoscaler driven by CPU/metrics.
- [ ] Resource requests/limits on every container.
- [ ] CloudFormation or eksctl so the cluster is reproducible.

## Definition of Done

- [ ] the service scales under load and recovers failed Pods
- [ ] the cluster can be recreated from code

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
