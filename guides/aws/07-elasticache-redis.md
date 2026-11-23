# 07 - ElastiCache for Redis

Goal: the managed Redis that matching-service depends on in production — the
services point at it via `REDIS_HOST`/`REDIS_PORT`, no code change. This powers
all four Redis roles already built: live driver state, GEO matching, cache-aside,
and the live-location Pub/Sub channel.

Independent of the async queue (guide 08); the two can be provisioned in either
order.

Time: ~15 min. Cost: ElastiCache bills **continuously** while the cluster exists.

---

## Why it's "just change env"

Locally the services talk to a `redis:7` container via
`spring.data.redis.host/port` (defaulted from `REDIS_HOST`/`REDIS_PORT`).
ElastiCache **is** managed Redis speaking the same protocol, so the Lettuce
client code is identical. In the cloud = point those two env vars at the
ElastiCache endpoint.

Mirrors the `../../iac/stacks/05-messaging.yaml` Redis section.

---

## 1. Create a Redis security group

1. VPC -> **Security groups** -> **Create security group**.
2. Name `ridenow-redis-sg`, VPC `ridenow`.
3. Inbound: **Custom TCP**, port **6379**, Source = the **EKS cluster security
   group** (Fargate pods attach to it, so only in-cluster pods reach Redis).
   **Create**.

## 2. Create a cache subnet group

1. ElastiCache -> **Subnet groups** -> **Create**.
2. Name `ridenow-redis-subnets`, VPC `ridenow`, add the **three private** subnets.

## 3. Create the Redis cluster

1. ElastiCache -> **Redis OSS caches** -> **Create**.
2. **Design your own cache**, cluster mode **disabled** (single-shard with a
   replica is enough for this workload).
3. Name: `ridenow-redis`.
4. Node type: **cache.r6g.large** (production).
5. Replicas: **1+** across AZs for automatic failover.
6. Subnet group: `ridenow-redis-subnets`. Security group: `ridenow-redis-sg`.
7. **Enable encryption in transit and at rest**.
8. **Create**. Wait for **Available**, then copy the **Primary endpoint** host.

---

## 4. Point the services at it

Set these env vars on the pods that use Redis - **driver-service** (live state,
5-minute position track, Pub/Sub, cache-aside), **matching-service** (GEO),
**notification-worker** (trip tracking pairing keys) and **realtime-gateway** (reads
the pairing keys, subscribes to Pub/Sub), then restart them:

```
REDIS_HOST = ridenow-redis.xxxx.ng.0001.apse1.cache.amazonaws.com
REDIS_PORT = 6379
REDIS_SSL  = true
```
`REDIS_SSL=true` is required because step 3 enabled encryption in transit. The
default is `false` (the local Redis container has no TLS); with TLS on and
`REDIS_SSL` unset, the connection fails at startup.

Edit their Deployment env (or re-apply the manifests with these values) and:

```bash
kubectl rollout restart deployment/driver-service deployment/matching-service \
  deployment/notification-worker deployment/realtime-gateway -n ridenow
```

The keys the services create (all ephemeral, so a Redis loss is acceptable):

| Key | Type | Owner | TTL |
|-----|------|-------|-----|
| `ridenow:driver:live:{driverId}` | hash | driver-service | 5 min |
| `ridenow:driver:track:{driverId}` | sorted set, last 5 min of positions | driver-service | 5 min |
| `ridenow:matching:geo:{TYPE}` | GEO index (a sorted set) | matching-service | none |
| `ridenow:tracking:trip:{tripId}`, `ridenow:tracking:driver:{driverId}` | string | notification-worker | 3 h |
| `ridenow:driver:profile:{driverId}` | cache-aside (JSON string) | driver-service | 10 min |

Memory: the position track is about 30 KB per online driver (roughly 600 points at one
update a second), so 10,000 online drivers is about 300 MB. `cache.r6g.large` has
about 13 GB, so it fits easily. Watch `DatabaseMemoryUsagePercentage` if you size down.

matching-service should run with `MATCHING_FINDER=redis` (it already defaults to
that in the compose/manifest) so it answers GEO queries from this cluster.

---

## Verify

- A driver goes online + reports a location (`POST /api/drivers/{id}/online`,
  `POST /api/drivers/{id}/location`), and `GET /api/drivers/{id}/live` returns the
  position - served from ElastiCache, not Postgres. Each location write also adds a
  point to `ridenow:driver:track:{driverId}` (`ZRANGE ... 0 -1` lists them oldest
  first).
- After feeding matching-service positions (its ingest endpoint), a match returns
  nearby drivers from Redis GEO.

## Clean up

ElastiCache runs continuously. When decommissioning the environment:
ElastiCache -> select `ridenow-redis` -> **Delete**. Without it, matching-service
can't answer GEO/live queries (driver/trip/payment still work).
