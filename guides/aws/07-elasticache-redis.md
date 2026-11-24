# 07 - ElastiCache for Valkey

Goal: the managed Valkey cache (Redis protocol) that matching-service depends on in
production — the services point at it via `REDIS_HOST`/`REDIS_PORT`, no code
change. This powers all five roles already built: live driver state, GEO matching,
cache-aside, the live-location Pub/Sub channel, and the driver-locations stream that
matching-service reads through a consumer group.

Why Valkey and not Redis OSS: same protocol, clients and commands (streams, GEO,
Pub/Sub), and AWS prices it about 20% lower for node-based clusters (33% lower for
serverless). The variable names keep `REDIS_*` because the clients are Redis clients.

Independent of the async queue (guide 08); the two can be provisioned in either
order.

Time: ~15 min. Cost: ElastiCache bills **continuously** while the cluster exists.

---

## Why it's "just change env"

Locally the services talk to a `valkey/valkey:8-alpine` container via
`spring.data.redis.host/port` (defaulted from `REDIS_HOST`/`REDIS_PORT`).
ElastiCache for Valkey speaks the same protocol, so the Lettuce client code is
identical. In the cloud = point those two env vars at the ElastiCache endpoint.

Mirrors the `../../iac/stacks/05-messaging.yaml` Redis section (`Engine: valkey`,
version 8.0, parameter group `default.valkey8`). The CloudFormation resource names
still say `Redis` on purpose, because renaming them would replace the cluster.

Already have a Redis OSS cluster from an earlier deploy? ElastiCache upgrades it to
Valkey in place (ElastiCache -> select the cluster -> **Modify** -> engine **Valkey**,
with the `default.valkey8` parameter group); the stack update does the same through
`Engine: valkey`. The data here is ephemeral and rebuilt by the apps, so a brief
loss is acceptable.

---

## 1. Create a cache security group

1. VPC -> **Security groups** -> **Create security group**.
2. Name `ridenow-redis-sg`, VPC `ridenow`.
3. Inbound: **Custom TCP**, port **6379**, Source = the **EKS cluster security
   group** (Fargate pods attach to it, so only in-cluster pods reach the cache).
   **Create**.

## 2. Create a cache subnet group

1. ElastiCache -> **Subnet groups** -> **Create**.
2. Name `ridenow-redis-subnets`, VPC `ridenow`, add the **two private** subnets.

## 3. Create the Valkey cluster

1. ElastiCache -> **Valkey caches** -> **Create**.
2. **Design your own cache**, cluster mode **disabled** (single-shard with a
   replica is enough for this workload).
3. Name: `ridenow-redis`.
4. Node type: **cache.t4g.small** (about 1.4 GB, plenty for 50 to 100 active drivers;
   `cache.t4g.micro` is enough for dev). Move to an r6g size only if memory grows.
5. Replicas: **1+** across AZs for automatic failover.
6. Subnet group: `ridenow-redis-subnets`. Security group: `ridenow-redis-sg`.
7. **Enable encryption in transit and at rest**.
8. **Create**. Wait for **Available**, then copy the **Primary endpoint** host.

---

## 4. Point the services at it

Set these env vars on the pods that use the cache - **driver-service** (live state,
5-minute position track, Pub/Sub, the driver-locations stream, cache-aside),
**matching-service** (GEO index, reads the stream),
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

The keys the services create (all ephemeral, so a cache loss is acceptable):

| Key | Type | Owner | TTL |
|-----|------|-------|-----|
| `ridenow:driver:live:{driverId}` | hash | driver-service | 5 min |
| `ridenow:driver:track:{driverId}` | sorted set, last 5 min of positions | driver-service | 5 min |
| `ridenow:matching:geo:{TYPE}` | GEO index (a sorted set) | matching-service | none |
| `ridenow:tracking:trip:{tripId}`, `ridenow:tracking:driver:{driverId}` | string | notification-worker | 3 h |
| `ridenow:driver:profile:{driverId}` | cache-aside (JSON string) | driver-service | 10 min |
| `ridenow:stream:driver-locations` | stream, consumer group `matching` | driver-service writes, matching-service reads | capped at about 10,000 entries (`RIDENOW_LOCATION_STREAM_MAX_LENGTH`) |
| `ridenow:stream:driver-locations-dlq` | stream, entries that failed 5 times | matching-service | capped at about 1,000 entries |
| `ridenow:matching:offline:{driverId}` | string (epoch millis), so a late position cannot revive an offline driver | matching-service | 10 min |

Memory: the position track is about 30 KB per online driver (roughly 600 points at one
update a second), so 100 online drivers is about 3 MB and 10,000 would be about 300 MB.
`cache.t4g.small` has about 1.4 GB, so it fits easily. Watch `DatabaseMemoryUsagePercentage`
if the number of drivers grows a lot.

The location stream adds about 2.5 MB at the default cap (10,000 entries of roughly 250
bytes, which is 100 to 200 seconds of history at 50 to 100 drivers posting once a second).
Raise `RIDENOW_LOCATION_STREAM_MAX_LENGTH` on driver-service if matching-service may be
down for longer than that and you need it to catch up fully.

Deploy driver-service first (so the stream is already being written), then
matching-service. While matching-service is down, entries wait in the stream (up to the
cap) and are applied when it is back.

matching-service should run with `MATCHING_FINDER=redis` (it already defaults to
that in the compose/manifest) so it answers GEO queries from this cluster.

---

## Verify

- A driver goes online + reports a location (`POST /api/drivers/{id}/online`,
  `POST /api/drivers/{id}/location`), and `GET /api/drivers/{id}/live` returns the
  position - served from ElastiCache, not Postgres. Each location write also adds a
  point to `ridenow:driver:track:{driverId}` (`ZRANGE ... 0 -1` lists them oldest
  first) and an entry to `ridenow:stream:driver-locations` (`XLEN` shows the length,
  `XINFO GROUPS ridenow:stream:driver-locations` shows group `matching` with its pending
  count, which should stay near 0; `XRANGE ridenow:stream:driver-locations-dlq - +` lists
  entries that failed 5 times).
- After feeding matching-service positions (its ingest endpoint), a match returns
  nearby drivers from Redis GEO, including drivers that only posted a location to
  driver-service (they arrive through the stream).

## Clean up

ElastiCache runs continuously. When decommissioning the environment:
ElastiCache -> select `ridenow-redis` (the Valkey cluster) -> **Delete**. Without it, matching-service
can't answer GEO/live queries (driver/trip/payment still work).
