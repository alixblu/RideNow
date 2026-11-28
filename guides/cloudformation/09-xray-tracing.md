# 09 - X-Ray tracing (OpenTelemetry agent, ADOT Collector, X-Ray console)

You rebuild the seven service images with the OpenTelemetry Java agent, apply the ADOT Collector, roll the services out, and then learn to read the traces in the AWS Console. Reference: `iac/k8s/15-adot-collector.yaml`, `iac/k8s/20-*.yaml` to `26-*.yaml`, `iac/stacks/01-iam.yaml` and `iac/stacks/07-eks-addons.yaml` (read only). Region `ap-southeast-1`, environment `prod`.

Part 1 deploys tracing (steps 1 to 5). Part 2 uses X-Ray in the console (steps 6 to 12), with four scenarios.

## What it creates

| Where | Resource | Resolved name |
|---|---|---|
| ECR | Seven new image tags with the agent jar at `/opt/otel/opentelemetry-javaagent.jar` | `ridenow/<service>:<IMAGE_TAG>` |
| Kubernetes `ridenow` | ServiceAccount | `adot-collector` (annotated with the IRSA role ARN) |
| Kubernetes `ridenow` | ConfigMap | `adot-collector-config` (`otlp` receiver, `filter/noise`, `batch`, `awsxray` exporter) |
| Kubernetes `ridenow` | Deployment, 2 replicas, requests 250m CPU / 512Mi, limits 500m / 1Gi | `adot-collector` |
| Kubernetes `ridenow` | Service, ClusterIP, ports 4317 (gRPC) and 4318 (HTTP) | `adot-collector` |
| Kubernetes `ridenow` | PodDisruptionBudget, `minAvailable: 1` | `adot-collector` |
| Kubernetes `ridenow` | Seven Deployments re-applied with the `OTEL_*` variables | `user-service`, `driver-service`, `trip-service`, `payment-service`, `matching-service`, `notification-worker`, `realtime-gateway` |

No AWS resource is created in this guide. The IAM policy and the IRSA role come from `01-iam.md` and `07-eks-addons.md`.

## Depends on

Look up each value in the console and keep it at hand. Region is `ap-southeast-1`, so check the region selector at the top right first.

| Value | Created in | Where to find it in the console |
|---|---|---|
| `ACCOUNT_ID` (12 digits) | your AWS account | Click your account name at the top right. Copy **Account ID**. |
| `AWS_REGION` | fixed | `ap-southeast-1` |
| Policy `ridenow-prod-adot-collector-xray` (export `iam-AdotCollectorXRayPolicyArn`) | `01-iam.md`, step 8 | **IAM -> Policies**. Search `ridenow-prod-adot-collector-xray`. It must be listed as `Customer managed`. |
| `ADOT_COLLECTOR_ROLE_ARN` (export `eks-AdotCollectorRoleArn`) | `07-eks-addons.md` | **IAM -> Roles -> `ridenow-prod-adot-collector`**. Copy **ARN**. The trust policy must name `system:serviceaccount:ridenow:adot-collector`. |
| Seven ECR repositories `ridenow/<service>` | `03-ecr.md` | **ECR -> Private registry -> Repositories**. |
| The seven services and the ALB running | `07-eks-addons.md`, `06-eks-cluster.md` | `kubectl get pods -n ridenow` shows 13 pods `1/1 Running`. |
| `ALB_DNS` | `06-eks-cluster.md`, Ingress step | **EC2 -> Load Balancers**, the ALB whose name starts with `k8s-ridenow`. Copy **DNS name**. Or `kubectl get ingress ridenow -n ridenow`. |
| `IMAGE_TAG` (new) | this guide, step 1 | Tags in `ridenow/*` are immutable (`03-ecr.md`), so the `v1.0.0` images without the agent cannot be overwritten. Pick a new tag, for example `v1.1.0`. |
| `ADOT_COLLECTOR_TAG` | this guide | `v0.51.0`, the tag pinned in `iac/scripts/deploy-and-test.sh`. Check it exists at **ECR -> Public registry -> Repositories**, search `aws-otel-collector`, or accept the pinned value. |
| `OTEL_AGENT_VERSION`, `OTEL_AGENT_SHA256` | the Dockerfiles | `2.34.0` and the SHA-256 on the `ARG OTEL_AGENT_SHA256=` line of each `<service>/Dockerfile`. They are the defaults, so you pass them only to change the version. |

Stop if the policy or the role is missing: the Collector pods would start but X-Ray would answer `AccessDenied`.

## Create the resources

Run the commands from the repository root in a bash shell (WSL). Assign the values first. Replace every `<paste>`.

```bash
ACCOUNT_ID="<paste>"
AWS_REGION=ap-southeast-1
ENV=prod
IMAGE_TAG="<paste>"                       # new tag, for example v1.1.0
ADOT_COLLECTOR_TAG=v0.51.0
ADOT_COLLECTOR_ROLE_ARN="<paste>"
APP_ORIGIN="<paste>"                      # same value as in 07-eks-addons.md
ALB_DNS="<paste>"
for V in ACCOUNT_ID IMAGE_TAG ADOT_COLLECTOR_ROLE_ARN APP_ORIGIN ALB_DNS; do
  case "${!V}" in ""|"<paste>") echo "NOT SET: $V" ;; esac
done
```

Expected: no `NOT SET:` line.

## Part 1: Deploy tracing

### 1. Build and push the images with the OTel agent

Each Dockerfile has a download stage that fetches the agent jar from the pinned GitHub release URL and fails the build if the SHA-256 differs. `ENTRYPOINT` is unchanged: the agent is attached only by `JAVA_TOOL_OPTIONS` in the Kubernetes manifest, so `docker compose` still runs the image without it.

```bash
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
for SVC in user-service driver-service trip-service payment-service \
           matching-service notification-worker realtime-gateway; do
  docker buildx build --platform linux/amd64 \
    -t "$REGISTRY/ridenow/$SVC:$IMAGE_TAG" \
    --push "./$SVC"
done
```

To change the agent version, add `--build-arg OTEL_AGENT_VERSION=<x.y.z> --build-arg OTEL_AGENT_SHA256=<sha256 of that jar>` to the `docker buildx build` line. Build args default to the values in the Dockerfile.

Expected: `Login Succeeded`, then seven pushes. A `sha256sum: FAILED` error in the `otel` stage means the jar does not match `OTEL_AGENT_SHA256`: do not skip the check, fix the value.

Check in the console: **ECR -> Private registry -> Repositories -> `ridenow/trip-service` -> Images**. The new `IMAGE_TAG` is listed.

### 2. Apply the ADOT Collector

The Collector goes first so the services find an OTLP endpoint when they start. The placeholders are `<REGION>`, `<ADOT_COLLECTOR_TAG>` and `<ADOT_COLLECTOR_ROLE_ARN>`.

```bash
sed -e "s|<REGION>|$AWS_REGION|g" \
    -e "s|<ADOT_COLLECTOR_TAG>|$ADOT_COLLECTOR_TAG|g" \
    -e "s|<ADOT_COLLECTOR_ROLE_ARN>|$ADOT_COLLECTOR_ROLE_ARN|g" \
    iac/k8s/15-adot-collector.yaml | kubectl apply -f -
kubectl rollout status deployment/adot-collector -n ridenow --timeout=600s
kubectl get pods -n ridenow -l app=adot-collector
kubectl get svc adot-collector -n ridenow
```

Expected: `serviceaccount/adot-collector`, `configmap/adot-collector-config`, `deployment.apps/adot-collector`, `service/adot-collector` and `poddisruptionbudget.policy/adot-collector` created (or `configured`). Two pods `1/1 Running`. The Service is `ClusterIP` with `4317/TCP,4318/TCP` and no `EXTERNAL-IP`.

Check the Collector logs for export errors:

```bash
kubectl logs deploy/adot-collector -n ridenow --tail=30
```

Expected: no `AccessDenied` and no `error` line. A line such as `Everything is ready. Begin running and processing data.` is normal. If you see `AccessDenied`, go to the Troubleshooting table.

### 3. Roll out the seven services with the agent

Apply the manifests with the new tag. The `OTEL_*` variables are already in `iac/k8s/20-*.yaml` to `26-*.yaml`: `JAVA_TOOL_OPTIONS=-javaagent:/opt/otel/opentelemetry-javaagent.jar`, `OTEL_SERVICE_NAME=<service>`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://adot-collector.ridenow.svc.cluster.local:4317`, `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`, `OTEL_PROPAGATORS=xray,tracecontext,baggage`, `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=1.0`, `OTEL_METRICS_EXPORTER=none` and `OTEL_LOGS_EXPORTER=none`. Three more switches, `OTEL_INSTRUMENTATION_SPRING_DATA_ENABLED`, `OTEL_INSTRUMENTATION_HIBERNATE_ENABLED` and `OTEL_INSTRUMENTATION_SPRING_SCHEDULING_ENABLED`, are `false`, so the service map has no nodes like `DriverPositionRepository.save`, `Transaction.commit` or `StreamRegistry.sendHeartbeats`. The JDBC database nodes stay.

The service manifests use the same placeholders as in `07-eks-addons.md`. Assign those values and build the `SUBST` list as in the Post-Deploy section of that guide, with the new `IMAGE_TAG`. The Collector placeholders are not needed here. Then run:

```bash
for F in 23-payment-service 20-user-service 21-driver-service 22-trip-service \
         24-matching-service 25-notification-worker 26-realtime-gateway; do
  sed "${SUBST[@]}" iac/k8s/$F.yaml | kubectl apply -f -
  kubectl rollout status deployment/${F#*-} -n ridenow --timeout=900s
done
```

The agent adds startup time and some memory. The `startupProbe` allows up to 5 minutes, so each rollout takes several minutes on Fargate.

Expected: seven `deployment "<service>" successfully rolled out` lines.

### 4. Confirm all pods are Ready

```bash
kubectl get pods -n ridenow
kubectl get pods -n ridenow -o jsonpath='{range .items[*]}{.metadata.name}{"  "}{.status.containerStatuses[0].lastState.terminated.reason}{"\n"}{end}' | grep -i oom || echo "no OOMKilled"
```

Expected: 15 pods `1/1 Running` (13 service pods from `07-eks-addons.md` plus 2 `adot-collector`) and `no OOMKilled`. If a pod is `OOMKilled`, raise its memory limit in its manifest (the comment above `JAVA_TOOL_OPTIONS` explains why) and apply again.

### 5. Verify: find one trace within 2 minutes

Create a rider and book a trip through the ALB, and print the `X-Trace-Id` response header. The services add this header with the X-Ray trace id of the request.

```bash
BASE="http://$ALB_DNS"
RUN=$(date +%s)
RIDER_ID=$(curl -s -X POST "$BASE/api/users" -H 'Content-Type: application/json' \
  -d "{\"cognitoSub\":\"trace-$RUN\",\"email\":\"trace.$RUN@test.com\",\"fullName\":\"Trace $RUN\"}" | jq -r .id)
echo "rider: $RIDER_ID"
curl -s -D - -o /dev/null -X POST "$BASE/api/trips" -H 'Content-Type: application/json' \
  -d "{\"passengerId\":\"$RIDER_ID\",\"rideType\":\"CAR\",\"pickupLat\":10.7769,\"pickupLng\":106.7009,\"destinationLat\":10.8231,\"destinationLng\":106.6297,\"paymentMethod\":\"SIMULATED_CARD\"}" \
  | grep -iE '^(HTTP|x-trace-id)'
```

Expected: `HTTP/1.1 201` and a line like `x-trace-id: 1-6650a1b2-3c4d5e6f7a8b9c0d1e2f3a4b`. Copy the value after `x-trace-id:`; it is the `TRACE_ID` used below. A `503` on the very first trip after a deploy is the payment cold start (see `docs/SERVICES.md`); send the request again. No `x-trace-id` header means the agent is not attached: see Troubleshooting.

Then, in the console:

1. In the AWS Console search box type `CloudWatch` and open **CloudWatch**. Check the region selector shows `Asia Pacific (Singapore) ap-southeast-1`.
2. In the left menu open **X-Ray traces -> Traces** (older consoles: **Application Signals -> Traces**).
3. Set the time range at the top to **Last 5 minutes** (or use **Absolute** to cover the request).
4. To open exactly this trace, paste this address in the browser with your id: `https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#xray:traces/<TRACE_ID>`. Or keep the **Last 5 minutes** list and select the row with your id. (`id("...")` is not a valid filter expression in the X-Ray API, so do not use it as a filter.)

Expected: within 2 minutes (the Collector batches for 5 seconds, X-Ray indexes in under a minute) the list shows one trace with a `POST /api/trips` URL and status 201. If the list is empty after 2 minutes, use the Troubleshooting table.

Command-line alternative (read only):

```bash
aws xray batch-get-traces --region ap-southeast-1 --trace-ids "<TRACE_ID>" --query 'length(Traces[0].Segments)'
```

Expected: a number greater than 1.

## Part 2: Use X-Ray in the console

Traces stay available in X-Ray for 30 days. Always select region `ap-southeast-1` (top right) before you look: another region shows an empty map.

Send some traffic first, so there is something to look at. The API test creates users, drivers and trips, accepts and completes one trip, and cancels another. It is defined in `iac/scripts/deploy-and-test.sh` (step 8, which runs `scripts/api-test.ps1`):

```bash
./iac/scripts/deploy-and-test.sh prod --tag "$IMAGE_TAG" --skip-stacks --yes
```

Expected: the test finishes with `DEPLOY AND TEST PASSED`, and the section `X-Ray traces` prints `X-RAY CHECK PASS: <n> trace(s) for service trip-service in the last 10 minutes`. The test traces are the ones you explore below. Without the script you can run `pwsh scripts/api-test.ps1 -BaseUrl "http://$ALB_DNS" -SkipHealth` from a machine with PowerShell.

### 6. Open the service map

1. In the console search box type `CloudWatch` and open **CloudWatch** (region `ap-southeast-1`).
2. In the left menu open **X-Ray traces -> Service map** (it may be labelled **Trace Map**).
3. Set the time range to **Last 30 minutes**.

How to read it:

- **Nodes are services.** Expect nodes for `trip-service`, `payment-service`, `user-service`, `driver-service`, `matching-service`, `notification-worker` and `realtime-gateway` (the last only after an SSE or WebSocket request), plus nodes for the AWS services they call: SNS (`ridenow-prod-events`), SQS queues, and the PostgreSQL and Redis calls of each service. Names come from `OTEL_SERVICE_NAME`.
- **Edges are calls.** An arrow from `trip-service` to `payment-service` is the synchronous authorize call. An arrow from `trip-service` to SNS is the event publish.
- **Node colour.** The circle is split by outcome: green for OK (2xx), red for fault (5xx), orange for error (4xx), purple for throttle (429). A fully green circle means no failed request in the time range.
- **Numbers on a node.** Average latency and requests per minute (or total requests) for that node, taken from the selected time range.
- **Open the traces behind a node or an edge.** Select a node (or the arrow), then choose **View traces** in the side panel. The **Traces** page opens with the matching filter expression, for example `service("trip-service")`.

Expected: the seven service nodes with mostly green circles and a latency in milliseconds on each.

### 7. Read the traces list

1. In the left menu open **X-Ray traces -> Traces**.
2. Set the time range to **Last 30 minutes**.
3. Choose **Run query** with an empty filter.

Columns of the **Traces** table:

| Column | Meaning |
|---|---|
| **ID** | The trace id (`1-...`). Select it to open the timeline. This is the value of the `X-Trace-Id` response header. |
| **Trace status** | OK, Error, Fault or Throttle for the whole trace. |
| **HTTP method / URL / HTTP status** | Of the first (entry) request, for example `POST` `/api/trips` 201. |
| **Response time** | Total time of the trace, in seconds. |
| **Segments** (or **Number of segments**) | How many services and calls joined the trace. One booking has several. |
| **Age** | Time since the trace started. |

Select **Show more columns** if a column is hidden.

Expected: rows for `/api/trips`, `/api/users`, `/api/payments` and so on. Health probes and idle SQS polls are not listed because the Collector drops them (`filter/noise`).

### 8. Read one trace timeline

1. In the **Traces** table select the **ID** of a `POST /api/trips` trace.
2. Look at the **Trace map** at the top and the **Segments timeline** below it.

How to read the timeline:

- Each row is a segment (a service) and its sub-segments (calls it made). The horizontal bar shows when the call started and how long it lasted, on the time scale on top.
- A child bar sits inside its parent bar. The **critical path** is the chain of bars that decides the total time: trip-service waits for payment-service, so payment-service's bar is on the critical path of the booking.
- Where the time is spent: compare bar lengths. The row with the longest bar that has no long child is where the time goes.
- The slowest span: sort mentally by bar length, or select a row and read its **Duration** in the side panel.
- Select a row to see **Overview**, **Resources**, **Annotations**, **Metadata** and **Exceptions**. Errors show here, in red.

Expected for a booking: `trip-service` `POST /api/trips`, a call to `payment-service` `POST /api/payments/...`, database calls for each service, and a `ridenow-events publish` span with the SNS call under it.

### 9. Filter expressions

Type each expression in the **Filter traces** box of the **Traces** page and choose **Run query**. Combine them with `AND` and `OR`.

| Expression | What it finds |
|---|---|
| `service("trip-service")` | Traces that went through trip-service. |
| `service("payment-service")` | Traces that went through payment-service, including capture traces started by an event. |
| `error` | Traces with a 4xx response or an error in any segment. |
| `fault` | Traces with a 5xx response or an exception in any segment. |
| `responsetime > 2` | Traces slower than 2 seconds. |
| `http.status = 500` | Traces whose entry request returned 500. |
| `http.url CONTAINS "/api/trips"` | Traces of the trip API, by URL. |
| `annotation.ridenow_event_type = "trip.completed"` | Traces that contain a `trip.completed` event span. |
| `annotation.messaging_destination_name = "ridenow-prod-payment"` | Traces that include the payment queue consumer (the capture side of a completed trip). |
| (no filter) | One specific trace: open `https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#xray:traces/<TRACE_ID>`, with the id from the `X-Trace-Id` header. |

About the annotation key: the Collector lists `ridenow.event.type` and `messaging.destination.name` in `indexed_attributes`, so they become X-Ray annotations. X-Ray does not allow `.` in annotation keys, and the `awsxray` exporter rewrites it to `_`. So `ridenow.event.type` is filtered as `annotation.ridenow_event_type`, and `messaging.destination.name` as `annotation.messaging_destination_name`. Check the exact key under **Annotations** in a trace row of the timeline; use that spelling if it differs.

Expected: `service("trip-service")` returns the same traces as selecting the `trip-service` node in step 6.

### 10. Group traces and open one trace by id

- **Group traces.** On the **Traces** page, look at the **Trace analytics** section (or **Group by**) above the table. Choose **Group by -> URL**, **HTTP status** or **Response time** to see counts per value. To keep a filter, choose **Create group** (**X-Ray traces -> Groups** in older consoles), set **Group name** to `ridenow-faults` and **Filter expression** to `fault`. The group then has its own service map and counts.
- **Open one trace by id.** Open `https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#xray:traces/<TRACE_ID>`, where `<TRACE_ID>` is the `x-trace-id` value from the response header (step 5). Select the single row. The same id is the `trace_id` in the logs (step 12).

Expected: grouped by HTTP status, most traces are `200`/`201`; the group `ridenow-faults` is empty until scenario 2.

### 11. The four scenarios

Run them in order. Each ends with a "You should see" line.

#### Scenario 1: booking

Send the booking from step 5, or reuse its trace.

1. Open `https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#xray:traces/<TRACE_ID>` (the id from step 5).
2. Open the trace.
3. Find the rows: trip-service HTTP span, the call to payment-service, the database calls (PostgreSQL), and the SNS publish.

You should see: one trace with `trip-service` as entry, a child call to `payment-service` (synchronous authorize), JDBC calls under each service, and the `trip.requested` publish span, all in one timeline. In the service map, the arrow `trip-service` -> `payment-service` appears.

#### Scenario 2: failing request (scale payment-service to 0, then restore)

Note the current replica count first, so that you can restore it:

```bash
kubectl get deployment payment-service -n ridenow -o jsonpath='{.spec.replicas}{"\n"}'
```

Expected: `2`. Stop payment-service, wait for the pods to end, and send a booking:

```bash
kubectl scale deployment/payment-service -n ridenow --replicas=0
kubectl wait --for=delete pod -l app=payment-service -n ridenow --timeout=120s
curl -s -D - -o /dev/null -X POST "$BASE/api/trips" -H 'Content-Type: application/json' \
  -d "{\"passengerId\":\"$RIDER_ID\",\"rideType\":\"CAR\",\"pickupLat\":10.7769,\"pickupLng\":106.7009,\"destinationLat\":10.8231,\"destinationLng\":106.6297,\"paymentMethod\":\"SIMULATED_CARD\"}" \
  | grep -iE '^(HTTP|x-trace-id)'
```

Expected: `HTTP/1.1 503` (the payment call fails, so no hold and no trip) and an `x-trace-id` line. Then in the console:

1. Open **X-Ray traces -> Traces** and filter with `fault` (or `http.status = 503`), time range **Last 5 minutes**.
2. Open the newest trace.
3. Select the red row of the call to payment-service and open **Exceptions**.
4. Open **X-Ray traces -> Service map** and look at `trip-service` and the payment call target.

You should see: the filter `fault` lists the 503 trace; the service map shows `trip-service` with a red (fault) slice, and the call target `payment-service` as a red node or red edge; in the timeline the call to payment-service is red and its **Exceptions** tab shows a connection error such as `UnknownHostException` or `Connection refused` for `payment-service:8083`.

Restore the original replica count and check the map returns to healthy:

```bash
kubectl scale deployment/payment-service -n ridenow --replicas=2
kubectl rollout status deployment/payment-service -n ridenow --timeout=900s
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/trips" -H 'Content-Type: application/json' \
  -d "{\"passengerId\":\"$RIDER_ID\",\"rideType\":\"CAR\",\"pickupLat\":10.7769,\"pickupLng\":106.7009,\"destinationLat\":10.8231,\"destinationLng\":106.6297,\"paymentMethod\":\"SIMULATED_CARD\"}"
```

Expected: `201` (a `503` on the first request is the payment cold start; send it again). In the console set the service map time range to **Last 5 minutes**, wait about a minute, and refresh: new traffic shows green circles again. The red slice stays in longer time ranges because the failed trace is still in the data (30 days). Cancel the test trips if you want a clean inbox (`POST /api/trips/<id>/cancel`).

#### Scenario 3: Capture_Flow (trip.completed -> payment capture)

The capture runs on events: `trip-service` publishes `trip.completed` to the SNS topic `ridenow-prod-events`, the `ridenow-prod-payment` queue delivers it, and payment-service captures the payment. The API test already completes one trip (sections 7 and 8 of `scripts/api-test.ps1`), so use the traces from the run above. To make one by hand you need a driver that accepts the trip; the API test does that for you.

1. Open **X-Ray traces -> Traces**, time range **Last 30 minutes**.
2. Filter with `annotation.ridenow_event_type = "trip.completed"`. Open the newest trace.
3. Open the newest trace.
4. Read the rows from top to bottom.

You should see: one trace in this order: the `POST /api/trips/{id}/complete` HTTP span of trip-service, the `ridenow-events publish` span (PRODUCER) with the `SNS.Publish` call under it, the consumer span `ridenow-prod-payment process trip.completed` in payment-service (CONSUMER), and below it the `payment.capture` span with the JDBC calls. If the trace shows only the trip-service part, the trace stopped at SNS: see Troubleshooting.

Correlate: in the **Overview** of the consumer span copy the trace id, and use step 12 to read the logs of the same trace in trip-service and payment-service.

#### Scenario 4: latency

1. Open **X-Ray traces -> Traces**, time range **Last 1 hour**.
2. Filter with `responsetime > 2`.
3. Sort the **Response time** column (select the column header) from high to low and open the first trace.
4. In the timeline find the row with the longest bar and no long child, select it, and read its **Duration**.

You should see: a short list (cold-start requests after a rollout are typical) whose slowest trace has one dominant bar, most often the payment-service call or a database call on a freshly started pod. If the list is empty, nothing was slower than 2 seconds in the range: that is a good result. Lower the threshold, for example `responsetime > 0.5`.

### 12. Find the logs of one trace

Each log line carries `trace_id=<X-Ray id> span_id=<span id>`, and `trace_id=-` when no trace is active. The `trace_id` is the same id as the `x-trace-id` header and the X-Ray trace id.

**Quick way, no CloudWatch Logs needed.** Search the pod logs with `kubectl`:

```bash
for S in trip-service payment-service notification-worker; do
  echo "== $S"; kubectl logs deploy/$S -n ridenow --tail=500 | grep "trace_id=<TRACE_ID>"
done
```

Expected: log lines from the services that handled the request. Replace `<TRACE_ID>` with the id from step 5. A successful request may log nothing at INFO level; error lines always carry the id.

**Logs Insights (needs the Fargate log router).** The pods only reach CloudWatch Logs when the log router from `iac/k8s/01-aws-logging.yaml` is applied (see `06-eks-cluster.md` and `10-cloudwatch.md`). Check first:

```bash
kubectl get ns aws-observability
aws logs describe-log-groups --region ap-southeast-1 --log-group-name-prefix /aws/eks/ridenow
```

Expected: the namespace exists and a pod log group `/aws/eks/<cluster>/fargate` is listed. If the namespace is missing, the services' logs are not in CloudWatch: use the `kubectl` way above. With the log group in place:

1. In the console open **CloudWatch -> Logs -> Logs Insights**.
2. Under **Select log group(s)** choose the pod log group.
3. Set the time range to cover the request, for example **1h**.
4. Paste the query, replace `<TRACE_ID>`, and choose **Run query**.

```
fields @timestamp, @logStream, @message
| parse @message "trace_id=* span_id=*" as trace_id, span_id
| filter trace_id = "<TRACE_ID>"
| sort @timestamp asc
```

You should see: log lines from `trip-service` and `payment-service` (and `notification-worker` for event-driven traces) with the same `trace_id`, in time order. To go the other way, copy a `trace_id` from a log line and open its trace with the address from step 5.

## Cost, sampling and limits

**Cost drivers.**

- X-Ray bills for traces recorded and for traces retrieved or scanned (console queries and `get-trace-summaries`). The free tier covers a small monthly volume; check the current prices on the X-Ray pricing page for `ap-southeast-1`.
- The two `adot-collector` pods on Fargate bill by vCPU and memory per hour while they run (requests 250m CPU / 512Mi each, rounded up to a Fargate size).
- CloudWatch Logs ingestion grows a little because every line now has two more fields.

**Sampling ratio.** The manifests set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=1.0`, so every request is recorded. That is right for a workshop. To record 10 percent, change the variable on each service (the new pods roll out by themselves):

```bash
for S in user-service driver-service trip-service payment-service matching-service notification-worker realtime-gateway; do
  kubectl set env deployment/$S -n ridenow OTEL_TRACES_SAMPLER_ARG=0.1
done
```

Expected: seven `deployment.apps/<service> env updated` lines. The change is lost when you re-apply the manifests, so also edit `OTEL_TRACES_SAMPLER_ARG` in `iac/k8s/20-*.yaml` to `26-*.yaml`. A consumer follows the sampling decision of the publisher (`parentbased`), so a capture trace is never half recorded. The Collector also drops health probes and idle SQS polls, which saves most of the volume.

**NetworkPolicy.** The cluster has no NetworkPolicy today. If you add one, allow ingress to the `adot-collector` pods (label `app=adot-collector`) on TCP 4317 (OTLP gRPC, used by the services) and TCP 4318 (OTLP HTTP), from the pods in namespace `ridenow`; and allow the `adot-collector` pods egress to the internet on TCP 443 (X-Ray endpoint) and UDP/TCP 53 (DNS). The Collector Service is `ClusterIP` only: no Ingress or load balancer routes to it.

**WebSocket and SSE limitation.** `realtime-gateway` emits one span for each HTTP request and for the WebSocket upgrade handshake. The frames inside an open WebSocket connection, and the events pushed on a long-lived SSE stream (`/live`), are not traced. A `/live` trace therefore shows a single long span for the whole stream, not one span per message.

## Troubleshooting

| Symptom | Check | Fix |
|---|---|---|
| No traces in the console | `kubectl logs deploy/adot-collector -n ridenow --tail=50`, and `kubectl describe pod -n ridenow -l app=trip-service` (read **Environment** for the `OTEL_*` variables). Also check the console region is `ap-southeast-1` and the time range covers the request. | Missing `JAVA_TOOL_OPTIONS` means the old manifest or old image: apply the manifest with the new `IMAGE_TAG` (step 3). A wrong `OTEL_EXPORTER_OTLP_ENDPOINT` must be `http://adot-collector.ridenow.svc.cluster.local:4317`. Run `iac/scripts/check-otel-env.sh` to compare every manifest. Widen the time range, select `ap-southeast-1`. |
| Response has no `X-Trace-Id` header | `curl -si "$BASE/api/trips?limit=1" \| grep -i x-trace-id` | The header appears only when the agent created a span. Same fix as above: image with the agent, `JAVA_TOOL_OPTIONS` set. |
| Collector log shows `AccessDenied` or `not authorized to perform: xray:PutTraceSegments` | **IAM -> Roles -> `ridenow-prod-adot-collector` -> Permissions** shows `ridenow-prod-adot-collector-xray`. `kubectl get sa adot-collector -n ridenow -o jsonpath='{.metadata.annotations}'` shows the role ARN. | Attach the policy (`01-iam.md` step 8, `07-eks-addons.md`). Fix the `<ADOT_COLLECTOR_ROLE_ARN>` annotation, apply `15-adot-collector.yaml` again, then `kubectl rollout restart deployment/adot-collector -n ridenow`. Check the role trust policy names `system:serviceaccount:ridenow:adot-collector`. |
| A trace stops at SNS: no consumer span in payment-service | In the trace, open the `ridenow-events publish` span. In **SQS -> Queues -> `ridenow-prod-payment` -> Monitoring**, check messages arrive. `kubectl logs deploy/payment-service -n ridenow --tail=50 \| grep -i "trace context"`. | The consumer must request `traceparent` and `X-Amzn-Trace-Id` as message attribute names. A warning `Malformed trace context on queue=...` means the attribute value is broken. Check **SNS -> Subscriptions** that the subscription has **Raw message delivery** enabled (`05-messaging.md`): without it the attributes are inside the SNS envelope and the consumer finds none. The consumer then starts a new trace, so you see two traces instead of one. |
| Missing `trace_id` (shows `trace_id=-`) in the logs | `kubectl logs deploy/trip-service -n ridenow --tail=20`. | `-` is normal for lines written outside a request (startup, schedulers). Inside a request, it means no agent (see above) or an old image whose `logback-spring.xml` is missing: rebuild the image. |
| Only the trip-service nodes appear, no payment-service edge | `kubectl get deploy payment-service -n ridenow` shows `0/0` or 0 ready. | Restore replicas to `2` (scenario 2). |
| `ImagePullBackOff` after step 3 | `kubectl describe pod -n ridenow -l app=trip-service` | The `IMAGE_TAG` was not pushed (step 1) or has a typo. Check **ECR -> Images**. |
| Collector pods `Pending` | `kubectl describe pod -n ridenow -l app=adot-collector` | The namespace `ridenow` needs its Fargate profile (`06-eks-cluster.md`). Wait a few minutes for a Fargate node. |

If the Collector is down, the services keep working: spans are dropped and no request fails.
<!-- 
## Cleanup

To stop tracing without removing the images, delete the Collector. The services keep running and drop their spans:

```bash
kubectl delete -f iac/k8s/15-adot-collector.yaml --ignore-not-found
```

Expected: five resources deleted. `iac/scripts/cleanup-cluster.sh` does the same during a full teardown. The IAM policy and the IRSA role are removed with `01-iam.md` and `07-eks-addons.md` resources.

Next: this guide completes the deployment. Return to `README.md` for the index. -->
