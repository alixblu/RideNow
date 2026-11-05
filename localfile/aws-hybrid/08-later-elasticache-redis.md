# 08 - Later op: ElastiCache for Redis (manual console)

Goal (when you want the Redis features live): a managed Redis the services point
at by changing `REDIS_HOST`/`REDIS_PORT` - no code change. Powers live driver
state, GEO matching, cache-aside, and the live-location Pub/Sub channel.

This is **identical** to `../aws/07-later-elasticache-redis.md` - follow it
click-by-click. The only hybrid note is which network values to reuse.

---

## Reuse the CloudFormation network values

- **Subnet group**: put Redis in the **private** subnets from
  `ridenow-dev-network-PrivateSubnetIds`.
- **Security group**: create `ridenow-redis-sg` allowing 6379 from the **EKS node
  security group** - use `ridenow-dev-network-NodeSecurityGroupId` as the source
  (tighter than the VPC CIDR):
  ```bash
  aws cloudformation list-exports --region ap-southeast-1 \
    --query "Exports[?Name=='ridenow-dev-network-NodeSecurityGroupId'].Value" --output text
  ```

Everything else (create the cache, copy the primary endpoint, set
`REDIS_HOST/PORT` on driver-service + matching-service, `kubectl rollout
restart`) is exactly as in `../aws/07`.

> The committed `iac/stacks/05-messaging.yaml` can also create this Redis via
> CloudFormation (gated off by default). This hybrid route does it manually on
> purpose - if you'd rather use the template, deploy stack 05 with
> `EnableRedis=true` instead; that's an IaC path, not this manual one.

## Verify

Per `../aws/07`: driver goes online + reports location -> `/live` returns it;
matching returns nearby drivers from Redis GEO.

Next: `09-later-sqs-eventbridge.md`.
