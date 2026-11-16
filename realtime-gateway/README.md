# realtime-gateway

Streams a driver's live position to the passenger of the trip, over Server-Sent
Events (SSE). It has no database and no business API. The full design (flow and
sequence diagrams, Redis keys, smooth-marker and road-snapping guidance) is in
[`docs/REALTIME.md`](../docs/REALTIME.md).

```
driver-service --(Redis Pub/Sub: ridenow:driver:locations)--> every gateway pod
notification-worker --(Redis keys ridenow:tracking:*, channel ridenow:tracking:ended)--> every gateway pod
gateway pod --(SSE: GET /live/trips/{tripId}/location?userId=)--> passenger app
```

Every pod subscribes to both channels. The pod holding the passenger's stream
delivers; the others have no stream for that trip and drop the message. So the
gateway scales horizontally with no sticky sessions.

Notifications do not go through the gateway. The apps poll notification-worker's
inbox at `GET /api/notifications?userId=&since=`.

## Client contract

1. Open the stream only while the trip is `DRIVER_ASSIGNED`, `DRIVER_ARRIVED` or
   `IN_PROGRESS`.
2. First fetch and draw the REST snapshot (`GET /api/trips/{id}`, and
   `GET /api/drivers/{driverId}/live`). The stream only adds updates.
3. Then open it:

   ```js
   const es = new EventSource(`/live/trips/${tripId}/location?userId=${passengerId}`);
   es.addEventListener("location", (e) => marker.push(JSON.parse(e.data)));
   es.addEventListener("trip-ended", () => { es.close(); refetchTrip(); });
   ```

4. Events:

   | Event | Data | Client action |
   |---|---|---|
   | `location` | `{"driverId","tripId","lat","lng","recordedAt"}`, no `id` | feed the smooth marker; order by `recordedAt` |
   | `trip-ended` | `{"tripId"}` | close the stream, refetch the trip over REST |

5. Status codes on open. All three mean "stop retrying":

   | Code | Meaning |
   |---|---|
   | 400 | `tripId` or `userId` is not a UUID |
   | 403 | `userId` is not this trip's passenger |
   | 410 | no pairing: the trip is not tracking yet, or it has ended |

   The browser's `EventSource` does not expose the status, but a non-200 response
   closes it for good (`error` with `readyState === CLOSED`). Stop then, and check the
   trip over REST. `error` with `readyState === CONNECTING` is a dropped connection the
   browser is already retrying.

6. `: ping` comments arrive every 15s. The first message sets a jittered `retry:`
   (about 1.5-4.5s), so after a server-side close the browser reconnects on its own
   without every client arriving together.
7. Close the stream on a terminal status or when the screen unmounts.

The stream is an optimization, never the source of truth. Pub/Sub is
at-most-once, so a position published while the client was reconnecting is gone;
the next one arrives a second later.

## Limits

| Limit | Default | Property |
|---|---|---|
| Streams per trip, per pod (a new one evicts the oldest) | 3 | `ridenow.gateway.max-streams-per-trip` |
| `location` events per trip | 1 per second | `ridenow.gateway.min-event-interval` |
| Stream lifetime (the browser reconnects after it) | 30m | `ridenow.gateway.stream-timeout` |
| Heartbeat comment | 15s | `ridenow.gateway.heartbeat-millis` |
| Base `retry:` (jittered +/-50%) | 3s | `ridenow.gateway.retry` |
| Driver-to-trip pairing cache | 5s (1s for "no pairing") | `pairing-cache-ttl`, `negative-cache-ttl` |

Responses carry `Cache-Control: no-cache` and `X-Accel-Buffering: no`, so proxies do
not buffer the stream.

## Shutdown

On SIGTERM the gateway completes every stream before the web server stops. Browsers
reconnect after the jittered `retry:` delay to the remaining pods. In Kubernetes a
`preStop` sleep lets the ALB deregister the pod first (`iac/k8s/26-realtime-gateway.yaml`).

## Known gaps

- **No authentication.** `userId` is trusted as given, so anyone who knows a
  passenger's id and trip id can watch that trip. The planned fix is a short-lived
  token checked on open.
- **Metrics.** Only health is exposed. Open-stream count and dropped-message counters
  are still to add, and the HPA scales on CPU.

## Run

```bash
./mvnw spring-boot:run          # needs Redis on localhost:6379 (REDIS_HOST/REDIS_PORT)
./mvnw test                     # no Redis needed; the relays are driven directly
curl -N "http://localhost:8086/live/trips/<tripId>/location?userId=<passengerId>"
```

Configuration: `SERVER_PORT` (8086), `REDIS_HOST`, `REDIS_PORT`, `REDIS_SSL`, and
`RIDENOW_GATEWAY_ALLOWED_ORIGINS`. The default `*` is for local use only, so set the
real app origin(s) in the cloud.
