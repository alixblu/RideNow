# 07 - Later op: ElastiCache for Redis

Goal (when you want the Redis features live in the cloud): a managed Redis the
services point at by changing `REDIS_HOST`/`REDIS_PORT` - no code change. This
powers all four Redis roles already built: live driver state, GEO matching,
cache-aside, and the live-location Pub/Sub channel.

Do this whenever you want those features on EKS. It has no dependency on the
async queue (guide 08); the two are independent.

Time: ~15 min. Cost: ElastiCache bills **continuously** while the cluster exists.

---

## Why it's "just change env"

Locally the services talk to a `redis:7` container via
`spring.data.redis.host/port` (defaulted from `REDIS_HOST`/`REDIS_PORT`).
ElastiCache **is** managed Redis speaking the same protocol, so the Lettuce
client code is identical. Moving to the cloud = point those two env vars at the
ElastiCache endpoint.

Mirrors the (gated) `../../iac/stacks/05-messaging.yaml` Redis section.

---

## 1. Create a Redis security group

1. VPC -> **Security groups** -> **Create security group**.
2. Name `ridenow-redis-sg`, VPC `ridenow`.
3. Inbound: **Custom TCP**, port **6379**, Source = the **EKS node security
   group** (so only pods can reach Redis), or the VPC CIDR `10.0.0.0/16` for a
   lab. **Create**.

## 2. Create a cache subnet group

1. ElastiCache -> **Subnet groups** -> **Create**.
2. Name `ridenow-redis-subnets`, VPC `ridenow`, add the **two private** subnets.

## 3. Create the Redis cluster

1. ElastiCache -> **Redis OSS caches** -> **Create**.
2. **Design your own cache**, cluster mode **disabled** (single primary is fine
   for the lab).
3. Name: `ridenow-redis`.
4. Node type: **cache.t4g.micro** (cheapest).
5. Replicas: 0 for a lab (1+ for resilience).
6. Subnet group: `ridenow-redis-subnets`. Security group: `ridenow-redis-sg`.
7. Encryption in transit/at rest: enable if you want (fine to leave default for
   a lab; the client uses plain host/port).
8. **Create**. Wait for **Available**, then copy the **Primary endpoint** host.

---

## 4. Point the services at it

Set these env vars on the pods that use Redis - **driver-service** (live state,
Pub/Sub, cache-aside) and **matching-service** (GEO), then restart them:

```
REDIS_HOST = ridenow-redis.xxxx.ng.0001.apse1.cache.amazonaws.com
REDIS_PORT = 6379
```

Edit their Deployment env (or re-apply the manifests with these values) and:

```bash
kubectl rollout restart deployment/driver-service deployment/matching-service -n ridenow
```

matching-service should run with `MATCHING_FINDER=redis` (it already defaults to
that in the compose/manifest) so it answers GEO queries from this cluster.

---

## Verify

- A driver goes online + reports a location (`POST /api/drivers/{id}/online`,
  `POST /api/drivers/{id}/location`), and `GET /api/drivers/{id}/live` returns the
  position - served from ElastiCache, not Postgres.
- After feeding matching-service positions (its ingest endpoint), a match returns
  nearby drivers from Redis GEO.

## Clean up

ElastiCache runs continuously: ElastiCache -> select `ridenow-redis` -> **Delete**
when you stop. Then the pods fall back to no live/GEO data (driver/trip/payment
still work; matching can't answer until Redis is back).
