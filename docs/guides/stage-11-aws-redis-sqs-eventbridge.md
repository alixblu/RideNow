# Stage 11 - Distributed-systems building blocks

> Part: PART 3 - AWS, CONSOLE FIRST
> Status: OUTLINE. Ask to expand this into full click-by-click console detail when you
> reach it, so the steps are verified against the current console at that time.
> Guides cover CONSOLE configuration only.
>
> NOTE: the LOCAL-FIRST build of this stage is already done. SQS + EventBridge run
> against LocalStack (`stage-11a-local-async-messaging.md`), and all four Redis roles
> run against a local Redis container (live driver state, Redis GEO in matching-service,
> cache-aside, Pub/Sub). The application code uses the real AWS SDK v2 / Spring Data
> Redis, so this stage is "provision the managed services in the console and point the
> same code at them by changing env only" - no application changes.

## Outline of steps

- [ ] Introduce each service ONLY when a feature needs it (not before). (Done locally.)
- [ ] ElastiCache for Redis: driver location, GEO lookup, shared state. (Code done; point
      `REDIS_HOST/PORT` at the ElastiCache endpoint.)
- [ ] SQS: async notification jobs, retries, dead-letter queue. (Code done; create the
      queue + DLQ and set the queue URL.)
- [ ] EventBridge: publish trip events to independent consumers. (Code done; create the
      bus + rule -> queue target.)
- [ ] Secrets Manager: move DB credentials out of config files.

## Definition of Done

- [ ] each service was introduced because a feature required it
- [ ] you can name the backend problem each one solves

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
