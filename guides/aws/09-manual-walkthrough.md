# 09 - Manual walkthrough: watch one ride flow through the system

Goal: run one ride by hand on prod (EKS Fargate) and watch each effect appear in
the API, SNS, SQS, Redis and the rider's live SSE tab. Every command is copy-paste.
Where a command needs an ID, you copy it from the previous response.

Time: ~20 min. Cost: the `redis-cli` debug pod is a small Fargate pod that bills
while it runs. Delete it at the end.

Facts used below:

| Item | Value |
|---|---|
| ALB | `http://k8s-ridenow-ridenow-ba80a25bbf-2045011000.ap-southeast-1.elb.amazonaws.com` |
| Account / region | `873716897107` / `ap-southeast-1` |
| Cluster / namespace | `ridenow-prod` / `ridenow` |
| Redis (Valkey, TLS) | `master.ridenow-prod-redis.ncr0ny.apse1.cache.amazonaws.com:6379` |
| SNS topic | `arn:aws:sns:ap-southeast-1:873716897107:ridenow-prod-events` |
| Queues | `ridenow-prod-matching`, `ridenow-prod-payment`, `ridenow-prod-notifications`, each with a DLQ |

Run everything in WSL. Open one terminal for commands (**T1**) and several for
watching (**T2** and up). Paste the setup block into every terminal.

---

## Setup (once per terminal)

```bash
A=http://k8s-ridenow-ridenow-ba80a25bbf-2045011000.ap-southeast-1.elb.amazonaws.com
H='Content-Type: application/json'
export PATH=$HOME/.local/bin:$PATH AWS_DEFAULT_REGION=ap-southeast-1 AWS_PAGER=""
REDIS=master.ridenow-prod-redis.ncr0ny.apse1.cache.amazonaws.com
aws eks update-kubeconfig --name ridenow-prod   # refresh after the cluster is recreated
```

Variables such as `RIDER` and `TRIP` exist only in the terminal where you set them.
In another terminal, set them again by pasting the same IDs.

---

## Part 1 - Create the actors (T1)

Replace each `PASTE-...` with the `id` field of the response above it.

```bash
# 1. rider user -> copy "id"
curl -s -X POST $A/api/users -H "$H" -d '{"cognitoSub":"rider-demo-1","email":"rider.demo1@t.com","fullName":"Rider Demo"}'
RIDER=PASTE-RIDER-ID

# 2. the driver's user account -> copy "id"
curl -s -X POST $A/api/users -H "$H" -d '{"cognitoSub":"driver-demo-1","email":"driver.demo1@t.com","fullName":"Driver Demo"}'
DUSER=PASTE-DRIVER-USER-ID

# 3. driver profile -> copy "id". This is DRIVER, not DUSER.
curl -s -X POST $A/api/drivers -H "$H" -d '{"userId":"'$DUSER'","licenseNumber":"LIC-DEMO-1"}'
DRIVER=PASTE-DRIVER-ID

# 4. vehicle, go online, first location
curl -s -X POST $A/api/drivers/$DRIVER/vehicles -H "$H" -d '{"plateNumber":"51A-DEMO1","vehicleType":"CAR","brand":"Toyota","model":"Vios","color":"white"}'
curl -s -X POST $A/api/drivers/$DRIVER/online -H "$H" -d '{}'
curl -s -X POST $A/api/drivers/$DRIVER/location -H "$H" -d '{"lat":10.7769,"lng":106.7009}'
```

A `409` means the email or licence already exists. Change the `demo-1` suffix and
retry. To see how much data exists, read `total` in the response of
`curl -s "$A/api/users?limit=1"`.

---

## Part 2 - Watch tools

### 2.1 Redis debug pod

Redis is private in the VPC, so inspect it from a pod. A pod without a
`SecurityGroupPolicy` uses the cluster security group, which can reach Redis.

```bash
kubectl run redis-cli -n ridenow --image=redis:7 --labels=app=redis-debug --restart=Never --command -- sleep 7200
kubectl wait -n ridenow --for=condition=Ready pod/redis-cli --timeout=180s
alias R="kubectl exec -n ridenow redis-cli -- redis-cli --tls -h $REDIS -p 6379"
R PING        # expect PONG
```

The pod takes about a minute to start on Fargate. The `R` alias lasts for that
terminal only.

### 2.2 Watcher terminals

Open each in its own terminal, after pasting the setup block.

```bash
# T2: every driver position update (Redis Pub/Sub channel)
kubectl exec -it -n ridenow redis-cli -- redis-cli --tls -h $REDIS SUBSCRIBE ridenow:driver:locations

# T3: "trip ended" signal
kubectl exec -it -n ridenow redis-cli -- redis-cli --tls -h $REDIS SUBSCRIBE ridenow:tracking:ended

# T4: events consumed by notification-worker
kubectl logs -n ridenow deploy/notification-worker -f

# T5: matching-service (consumes trip.requested, publishes match.offered)
kubectl logs -n ridenow deploy/matching-service -f
```

The rider's live tab (**T6**) is opened in Part 3, step 2.

### 2.3 Matching-service port-forward (T1)

matching-service has no public route.

```bash
kubectl port-forward -n ridenow svc/matching-service 18085:8085 &
```

---

## Part 3 - The ride, step by step (T1)

### Step 1 - Request the trip

```bash
curl -s -X POST $A/api/trips -H "$H" -d '{"passengerId":"'$RIDER'","rideType":"CAR","pickupLat":10.7769,"pickupLng":106.7009,"destinationLat":10.8231,"destinationLng":106.6297,"paymentMethod":"SIMULATED_CARD"}'
TRIP=PASTE-TRIP-ID        # status is SEARCHING
```

What happens:

1. trip-service calls payment-service over HTTP to authorize the fare.
2. After commit, trip-service publishes `trip.requested` to SNS.
3. SNS delivers it to the matching queue (filter `trip.requested`) and the
   notifications queue (no filter). The payment queue receives nothing.
4. matching-service reads its queue, finds nearby online drivers in the Redis GEO
   index, stores PENDING offers, and publishes `match.offered` to SNS.
5. notification-worker writes inbox rows: `trip.requested` for the rider and
   `match.offered` for the driver.

Check it:

```bash
curl -s "$A/api/payments?tripId=$TRIP"                          # status AUTHORIZED
curl -s "$A/api/notifications?userId=$RIDER"                    # trip.requested
curl -s "$A/api/notifications?userId=$DRIVER"                   # match.offered (after a few seconds)
curl -s localhost:18085/api/matching/trips/$TRIP/offers         # a PENDING offer for $DRIVER
```

T4 and T5 print the log lines for the same events.

### Step 2 - Driver accepts, and the rider's tab goes live

```bash
curl -s -X POST "$A/api/trips/$TRIP/accept?driverId=$DRIVER"    # status DRIVER_ASSIGNED
```

What happens: trip-service publishes `driver.accepted`. notification-worker sets
two Redis keys that pair the driver with the rider's trip, each with a 3 hour TTL.
The gateway streams a driver's position to a rider only while this pairing exists.

Check it:

```bash
R GET ridenow:tracking:trip:$TRIP          # {"passengerId":...,"driverId":...}
R GET ridenow:tracking:driver:$DRIVER      # {"tripId":...,"passengerId":...}
R TTL ridenow:tracking:trip:$TRIP          # about 10800
curl -s "$A/api/notifications?userId=$RIDER"     # now includes driver.accepted
```

Open the rider's live tab in **T6** and leave it open:

```bash
curl -N "$A/live/trips/$TRIP/location?userId=$RIDER"
```

Before the accept this returns `410` (no tracking for the trip). A different
`userId` returns `403`.

### Step 3 - Move the driver and watch the realtime update

```bash
curl -s -X POST $A/api/drivers/$DRIVER/location -H "$H" -d '{"lat":10.7790,"lng":106.7020}'
curl -s -X POST $A/api/drivers/$DRIVER/location -H "$H" -d '{"lat":10.7830,"lng":106.7050}'
```

What happens:

1. driver-service stores the position in Redis (live hash and a short history),
   appends it to a stream, and publishes it on a channel.
2. realtime-gateway receives the channel message. If the driver is paired with a
   trip, it sends an SSE event to that trip's rider. Otherwise it drops it.
3. matching-service reads the stream and updates the GEO index.

Check it:

- **T6** prints a location event with `driverId`, `tripId`, `lat`, `lng`.
- **T2** prints the same message on the channel.

```bash
R HGETALL ridenow:driver:live:$DRIVER                              # latest position and availability
R ZRANGE ridenow:driver:track:$DRIVER 0 -1 WITHSCORES              # recent position history
R XLEN ridenow:stream:driver-locations                             # grows with each update
R XREVRANGE ridenow:stream:driver-locations + - COUNT 3            # last 3 entries, JSON in field "payload"
R --scan --pattern 'ridenow:matching:geo:*'                        # GEO keys; then: R ZRANGE <key> 0 -1
```

The stream length is capped, so `XLEN` stops growing at the cap.
A position posted for a driver with no trip reaches T2 but never T6.

### Step 4 - Arrive, start, complete

```bash
curl -s -X POST $A/api/trips/$TRIP/arrive      # DRIVER_ARRIVED -> event driver.arrived
curl -s -X POST $A/api/trips/$TRIP/start       # IN_PROGRESS    -> event trip.started
curl -s -X POST $A/api/trips/$TRIP/complete    # COMPLETED      -> event trip.completed
```

What happens on `complete`:

1. The payment queue and the notifications queue both receive `trip.completed`.
2. payment-service captures the payment (AUTHORIZED to PAID) and publishes
   `payment.succeeded`.
3. notification-worker deletes both pairing keys and publishes the trip id on the
   `ridenow:tracking:ended` channel.
4. The rider's SSE stream receives `trip-ended` and closes.

Check it:

```bash
curl -s "$A/api/payments?tripId=$TRIP"                      # PAID, after a few seconds
curl -s "$A/api/notifications?userId=$RIDER"                # the whole lifecycle
R EXISTS ridenow:tracking:trip:$TRIP                        # 0, key deleted
curl -N "$A/live/trips/$TRIP/location?userId=$RIDER"        # 410, trip ended
```

T3 prints the trip id and T6 shows `trip-ended`. Inbox items may not be in strict
lifecycle order, because each event travels through SNS and SQS independently.

### Step 5 (optional) - Cancel instead

Create a second trip as in step 1 (save its id as `TRIP2`), then:

```bash
curl -s -X POST $A/api/trips/$TRIP2/cancel              # no request body; status CANCELLED
curl -s "$A/api/payments?tripId=$TRIP2"                 # RELEASED, after a few seconds
curl -s "$A/api/notifications?userId=$RIDER"            # includes trip.cancelled
```

`trip.cancelled` goes to the payment queue (release the hold) and the
notifications queue. It also deletes the pairing keys if they exist.

---

## Part 4 - Check SNS and SQS

### AWS console (region Asia Pacific (Singapore), `ap-southeast-1`)

| Where | What to look at |
|---|---|
| SNS, Topics, `ridenow-prod-events`, **Subscriptions** | Three subscriptions, one per queue. Open the matching and payment ones to see the filter policy: `trip.requested`; `trip.completed` and `trip.cancelled`. |
| SNS, the topic, **Monitoring** | `NumberOfMessagesPublished` rises with each action. `NumberOfNotificationsFilteredOut` counts events a filtered queue skipped. |
| SQS, each `ridenow-prod-*` queue, **Monitoring** | `NumberOfMessagesSent` and `NumberOfMessagesDeleted` rise together. CloudWatch lags 1 to 5 minutes. |
| SQS, each `-dlq` queue | The message count must stay 0. A message there means a consumer failed 5 times in a row. |

The queues normally show 0 messages, because consumers read and delete each message
within milliseconds. Do not rely on the console **Send and receive messages** page
to catch messages. It competes with the consumers. Use the Monitoring graphs and
the pod logs (T4, T5) instead.

### Local terminal

```bash
# message counts per queue
for q in matching payment notifications; do
  echo -n "$q: "
  aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-southeast-1.amazonaws.com/873716897107/ridenow-prod-$q \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query Attributes --output text
done

# subscriptions on the topic
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:ap-southeast-1:873716897107:ridenow-prod-events \
  --query "Subscriptions[].[Endpoint,SubscriptionArn]" --output text

# events published in the last 15 minutes
aws cloudwatch get-metric-statistics --namespace AWS/SNS --metric-name NumberOfMessagesPublished \
  --dimensions Name=TopicName,Value=ridenow-prod-events --statistics Sum --period 60 \
  --start-time $(date -u -d '-15 min' +%FT%TZ) --end-time $(date -u +%FT%TZ) --output table
```

---

## Part 5 - Database counts

The seed migrations load demo rows into user, driver, trip and payment. matching
and notification hold only data created by running the system. Read `total` in
each response:

```bash
curl -s "$A/api/users?limit=1"
curl -s "$A/api/drivers?limit=1"
curl -s "$A/api/trips?limit=1"
```

---

## Event map

| Event | Published by | Queues reached | Effect |
|---|---|---|---|
| `trip.requested` | trip-service | matching, notifications | offers created, rider inbox |
| `match.offered` | matching-service | notifications | driver inbox |
| `driver.accepted` | trip-service | notifications | pairing keys set, rider inbox |
| `driver.arrived`, `trip.started` | trip-service | notifications | rider inbox |
| `trip.completed` | trip-service | payment, notifications | payment captured, pairing keys deleted |
| `payment.succeeded` | payment-service | notifications | rider inbox |
| `trip.cancelled` | trip-service | payment, notifications | payment released, pairing keys deleted |

## Notes

- The Redis key, channel and stream names come from the service code. If a `R`
  command returns nothing, check that the step before it succeeded.
- CloudWatch metrics lag 1 to 5 minutes. Use pod logs for instant feedback.
- `GET /api/payments?tripId=` returns one payment with a `status` field. This is
  how `scripts/api-test.ps1` reads it.

## Clean up

```bash
kubectl delete pod redis-cli -n ridenow
kill %1 2>/dev/null        # stops the matching-service port-forward in T1
```
