# realtime-gateway

Holds the WebSocket connections to the rider and driver apps and pushes
notifications to them. It has no database and no business API; the only HTTP
endpoint besides the socket is `/actuator/health` for probes.

```
notification-worker --(Redis Pub/Sub: ridenow.notifications)--> every gateway pod
gateway pod --(STOMP over WebSocket: /topic/users/{userId})--> rider / driver app
```

Every gateway pod subscribes to the Redis channel. The pod that holds the target
user's socket delivers the message. The other pods have nobody subscribed to that
topic, so they drop it. This is why the gateway scales horizontally with no sticky
sessions.

## Client contract

1. Open a WebSocket to `/ws` and send a STOMP `CONNECT`.
2. `SUBSCRIBE` to exactly `/topic/users/{yourUserId}`. The id must be a lowercase UUID.
3. Each message body is JSON:

   ```json
   {
     "eventId": "6f1c...",
     "userId": "1111...",
     "type": "driver.accepted",
     "message": "A driver has accepted your trip.",
     "tripId": "4444...",
     "occurredAt": "2026-11-11T07:00:00Z"
   }
   ```

### The resync rule: the socket is never the source of truth

**On every connect AND every reconnect, first fetch current state over REST,
then resume the stream.** For example, call `GET /api/trips/{id}` for the trip
on screen.

The reasons:

- Redis Pub/Sub is at-most-once. Anything published while the client was offline
  (backgrounded, tunnel, network switch, pod restart) is gone. REST holds the
  real state, so the client loses nothing that matters.
- Drop a message whose `eventId` you have already seen, because a retried upstream
  event can repeat.
- Ignore a message older (by `occurredAt`) than the state you just fetched.

### Reconnecting

- Reconnect with **exponential backoff plus jitter**, for example 1s, 2s, 4s and so on,
  capped at 30s, each with a random +/-50%. Jitter stops every client of a
  restarted pod from reconnecting in the same instant.
- Put a **connect timeout** (about 5s) on every attempt. A proxy or load balancer in
  front of a restarting pod can accept the TCP connection and never finish the
  WebSocket handshake. Without a timeout, the client stays "connecting"
  forever and never retries. This was observed in the local stack, where Docker's port
  proxy does it while the container restarts.
- A close with code **1001** and reason `reconnect` means the gateway is
  shutting down (a rolling deploy). Reconnect right away (with jitter), and you
  will land on a healthy pod. Code 1001 was chosen over 1012 because every
  WebSocket implementation accepts it.
- STOMP heartbeats run every 10s in both directions. If the client stops
  hearing them, it should treat the connection as dead and reconnect.

## Limits (per connection)

| Limit | Default | Property |
|---|---|---|
| Max frame size from a client | 8 KiB | `ridenow.gateway.max-message-bytes` |
| Subscriptions per connection | 5 | `ridenow.gateway.max-subscriptions-per-session` |
| Frames per window | 60 per 10s | `ridenow.gateway.max-frames-per-window`, `frame-window` |
| Heartbeat (both ways) | 10s | `ridenow.gateway.heartbeat` |

Clients are receive-only: a `SEND` frame is rejected. A `SUBSCRIBE` to anything other
than an exact `/topic/users/{uuid}` is also rejected. Wildcards are blocked on purpose,
because `/topic/users/**` would otherwise receive every user's notifications. A
rejected frame gets a STOMP `ERROR` and the connection is closed.

## Known gaps

- **No authentication.** A client connects with just a user id, so anyone who
  knows a user id can subscribe to that user's notifications. The planned fix is to
  validate a short-lived JWT at `CONNECT`, use `wss://`, and check each
  subscription against the token's user.
- **No durable inbox.** A notification is not stored for an offline user. The
  resync rule covers state, but not the "you missed this" history.
- **No push for closed apps.** A WebSocket reaches only a connected, foreground
  app. Mobile push (FCM/APNs) is out of scope.
- **Metrics.** Only health is exposed. Connected-socket count, reconnect rate and
  dropped-message counters are still to add.

## Run

```bash
./mvnw spring-boot:run          # needs Redis on localhost:6379 (REDIS_HOST/REDIS_PORT)
./mvnw test                     # no Redis needed; the relay is driven directly
```

Configuration: `SERVER_PORT` (8086), `REDIS_HOST`, `REDIS_PORT`,
`RIDENOW_GATEWAY_CHANNEL`, and `RIDENOW_GATEWAY_ALLOWED_ORIGINS`. The default `*`
is for local use only, so set the real app origin(s) in the cloud.
