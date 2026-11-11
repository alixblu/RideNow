# 06a - Observability: verify, configure, and monitor RideNow on EKS

Goal: get every observability component working, build dashboards, configure
alerts, and run deliberate failure simulations so you know monitoring is
detecting real problems before your app goes to production.

Time: ~60–90 min end-to-end (Grafana setup and alert wiring take the longest).

---

## Cost summary

| Component | Meter | Rough cost |
|-----------|-------|------------|
| AMP | per sample ingested + per query | ~$0.10–0.30/day |
| Fargate log router -> CloudWatch Logs | per GB ingested + storage | ~$0.05–0.20/day |
| Application Signals (sidecar) | per trace + per metric | ~$0.05–0.15/day |
| Control plane logs (5 types) | per GB ingested | ~$0.10–0.40/day |
| CloudWatch alarms | per alarm per month | $0.10/alarm/month |
| SNS email | first 1000 free | $0 |

All costs are for `ap-southeast-1`. On Fargate there is no DaemonSet-based
Container Insights or Network Flow Monitor agent — pod logs reach CloudWatch via
the Fargate log router, and pod metrics via the AMP agentless scraper.

---

## Prerequisites — check these before starting

### IAM permissions needed

Your `ridenow-admin` user needs these policies (in addition to EKS access):

- `AmazonPrometheusFullAccess`
- `CloudWatchFullAccess`
- `AmazonSNSFullAccess`
- `CloudWatchApplicationSignalsFullAccess`

Verify:
```bash
aws sts get-caller-identity
aws iam list-attached-user-policies --user-name ridenow-admin \
  --query "AttachedPolicies[*].PolicyName" --output table --no-cli-pager
```

### EKS add-ons needed

On Fargate the DaemonSet-based agents (`amazon-cloudwatch-observability`, `adot`)
are **not** installed — they can't run without nodes. Confirm only the Fargate-
compatible add-ons are present:

```bash
aws eks list-addons --cluster-name ridenow --region ap-southeast-1 \
  --no-cli-pager --output table
```

Expected add-ons: `kube-state-metrics` and `metrics-server` (both Deployments).
Prometheus metrics come from the **AMP agentless scraper** (a managed scraper
resource, not an in-cluster add-on — set up in Part 1) and pod logs from the
**Fargate log router** (Part 1).

### Spring Boot Actuator (for HTTP metrics)

The RideNow services need Actuator + Micrometer Prometheus to expose
`/actuator/prometheus`. Confirm each service's `pom.xml` includes:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
  <groupId>io.micrometer</groupId>
  <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

And `application.properties`:

```properties
management.endpoints.web.exposure.include=health,prometheus,info,metrics
management.endpoint.prometheus.enabled=true
```

Without this, the HTTP latency and 5xx queries in Parts 2 and 4 will return no
data.

---

## Part 1 — Set up and verify Fargate observability

On Fargate the telemetry pipeline is: the **AMP agentless scraper** pulls pod
metrics, the **Fargate log router** ships pod logs to CloudWatch, and the control
plane emits its own logs. There are no DaemonSet agents to verify.

### 1.1 AMP workspace + agentless scraper

The agentless scraper is a managed AMP scraper that discovers pods and scrapes
their `/actuator/prometheus` endpoints — no ADOT DaemonSet in the cluster.

**Console:** Amazon Managed Service for Prometheus → Workspaces → click
`ridenow_workspace`.
- Status should be **Active**.
- Copy the **Endpoint - remote write URL** (you will need it in Part 2).

**Console:** EKS → `ridenow` cluster → **Observability** tab → **Scrapers**. If no
scraper exists, **Add scraper**, target this cluster, and point it at the
`ridenow_workspace`. Confirm the scraper reaches **Active**.

**CLI:**
```bash
aws amp list-workspaces --region ap-southeast-1 --no-cli-pager \
  --query "workspaces[*].[alias,status.statusCode,workspaceId]" --output table

aws amp list-scrapers --region ap-southeast-1 --no-cli-pager \
  --query "scrapers[*].[alias,status.statusCode]" --output table
```

Expected: `ridenow_workspace` **ACTIVE** and one scraper **ACTIVE**.

### 1.2 Fargate log router (pod logs -> CloudWatch)

Fargate has no node to run a log DaemonSet, so logging is configured by a
ConfigMap in the `aws-observability` namespace (its Fargate profile was created
in guide 05). Apply it once:

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: aws-observability
  labels:
    aws-observability: enabled
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: aws-logging
  namespace: aws-observability
data:
  flb_log_cw: "true"
  output.conf: |
    [OUTPUT]
        Name cloudwatch_logs
        Match kube.*
        region ap-southeast-1
        log_group_name /aws/eks/ridenow/fargate
        log_stream_prefix fargate-
        auto_create_group true
EOF
```

The Fargate pod execution role already carries the permissions the router needs
(it ships with `AmazonEKSFargatePodExecutionRolePolicy`). Pods scheduled **after**
the ConfigMap exists get their stdout/stderr shipped to the
`/aws/eks/ridenow/fargate` log group. Verify after deploying services (guide 06):

```bash
aws logs describe-log-streams \
  --log-group-name /aws/eks/ridenow/fargate \
  --region ap-southeast-1 --no-cli-pager \
  --query "logStreams[*].logStreamName" --output table
```

### 1.3 Application Signals (APM, sidecar)

If you enabled Application Signals on the cluster (guide 05), it instruments each
pod via an **injected sidecar** (not a DaemonSet), so it works on Fargate. Confirm
the sidecar is present on a running app pod:

```bash
kubectl get pod -n ridenow -l app=driver-service \
  -o jsonpath='{.items[0].spec.containers[*].name}'
# Expect the app container plus a cloudwatch-agent / adot sidecar name
```

APM traces, latency, and error rate appear under CloudWatch → **Application
Signals** once traffic flows.

### 1.4 Kube State Metrics + metrics-server (Deployments)

These two run as Deployments, so they're the Fargate-friendly source of
Kubernetes object metrics (for PromQL) and pod CPU/memory (for the HPA):

```bash
kubectl get deploy -n kube-system metrics-server
kubectl get deploy -A | grep -i kube-state-metrics
# both READY 1/1 (or n/n), Running on Fargate
```

### 1.5 Control plane log streams

**Console:** CloudWatch → **Log groups** → search `/aws/eks/ridenow/cluster`.

You should see five log streams:

| Log stream prefix | Log type |
|-------------------|----------|
| `kube-apiserver-*` | API server |
| `kube-audit-*` | Audit |
| `authenticator-*` | Authenticator |
| `kube-controller-manager-*` | Controller manager |
| `kube-scheduler-*` | Scheduler |

They take 5–10 min after cluster creation to appear. Click any stream and
confirm there are recent log entries.

**CLI check:**
```bash
aws logs describe-log-streams \
  --log-group-name /aws/eks/ridenow/cluster \
  --region ap-southeast-1 \
  --no-cli-pager \
  --query "logStreams[*].[logStreamName,lastIngestionTime]" \
  --output table
```

---

## Part 2 — Prometheus metric collection and PromQL queries

### 2.1 Get the AMP query endpoint

```bash
WORKSPACE_ID=$(aws amp list-workspaces --region ap-southeast-1 \
  --query "workspaces[?alias=='ridenow_workspace'].workspaceId" \
  --output text --no-cli-pager)
echo "Workspace ID: $WORKSPACE_ID"

QUERY_ENDPOINT="https://aps-workspaces.ap-southeast-1.amazonaws.com/workspaces/$WORKSPACE_ID"
echo "Query endpoint: $QUERY_ENDPOINT"
```

### 2.2 Test a raw PromQL query from the CLI

```bash
aws amp query-metrics \
  --workspace-id $WORKSPACE_ID \
  --query-string 'up' \
  --region ap-southeast-1 \
  --no-cli-pager
```

Expected: JSON response with `status: success` and a list of targets. If empty,
the scraper has not collected any metrics yet — wait 2 min and retry.

### 2.3 Connect Grafana to AMP

If you don't have Grafana running yet, deploy it in the cluster:

```bash
kubectl create namespace grafana

kubectl create secret generic grafana-admin \
  --from-literal=admin-password=RideNow2024! \
  -n grafana

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: grafana
spec:
  replicas: 1
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:latest
          ports:
            - containerPort: 3000
          env:
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-admin
                  key: admin-password
---
apiVersion: v1
kind: Service
metadata:
  name: grafana
  namespace: grafana
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 3000
  selector:
    app: grafana
EOF
```

Wait ~2 min, then get the external URL:
```bash
kubectl get svc grafana -n grafana
# Copy the EXTERNAL-IP value
```

Open `http://<EXTERNAL-IP>` in your browser. Login: `admin` / `RideNow2024!`.

**Add AMP as a data source in Grafana:**
1. Grafana → **Connections** → **Data sources** → **Add data source** →
   **Prometheus**.
2. **URL**: paste your AMP query endpoint URL from step 2.1, appending
   `/api/v1/prometheus` → full URL:
   `https://aps-workspaces.ap-southeast-1.amazonaws.com/workspaces/<ID>/api/v1/prometheus`
3. **Authentication**: **SigV4 auth** → Region: `ap-southeast-1` → Auth
   provider: **AWS SDK Default**. On Fargate, give the Grafana pod an IRSA role
   with `aps:QueryMetrics`/`aps:GetLabels` (annotate its service account) — there
   is no node role to fall back on.
4. **Save & test** → should return "Data source is working".

### 2.4 Core PromQL queries

Use these in Grafana **Explore** (or the AMP console **Query editor**):

```promql
# CPU usage per pod (millicores)
sum(rate(container_cpu_usage_seconds_total{namespace="ridenow"}[5m])) by (pod)

# Memory usage per pod (bytes)
sum(container_memory_working_set_bytes{namespace="ridenow"}) by (pod)

# Pod restart count (all namespaces)
sum(kube_pod_container_status_restarts_total) by (pod, namespace)

# HTTP 5xx error rate per service (requires Spring Boot Actuator)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) by (uri, pod)

# HTTP request latency p99 per service
histogram_quantile(0.99,
  sum(rate(http_server_requests_seconds_bucket{namespace="ridenow"}[5m]))
  by (le, pod, uri)
)

# Pod count per service
count(kube_pod_info{namespace="ridenow"}) by (pod)
```

---

## Part 3 — Grafana dashboards

### 3.1 Import the community EKS dashboard

1. Grafana → **Dashboards** → **Import**.
2. Enter dashboard ID **17119** → **Load**.
3. Select your AMP data source → **Import**.

This gives you a pre-built EKS cluster overview: pod CPU/memory, pod counts, and
network I/O. On Fargate the node-level panels populate per Fargate virtual node
(one per pod) rather than per EC2 instance; the pod-level panels are the useful
ones.

### 3.2 Build a RideNow services dashboard

1. Grafana → **Dashboards** → **New** → **New Dashboard** → **Add panel**.
2. Create one row per service. For each service (user-service, driver-service,
   trip-service, payment-service), add these panels:

**CPU panel:**
```promql
sum(rate(container_cpu_usage_seconds_total{pod=~"user-service-.*"}[5m])) by (pod)
```
(Replace `user-service-.*` with the actual pod name pattern for each service.)

**Memory panel:**
```promql
sum(container_memory_working_set_bytes{pod=~"user-service-.*"}) by (pod)
```

**Restart count panel (Stat type):**
```promql
sum(kube_pod_container_status_restarts_total{pod=~"user-service-.*"}) by (pod)
```

**HTTP 5xx rate panel:**
```promql
sum(rate(http_server_requests_seconds_count{status=~"5..",pod=~"user-service-.*"}[5m])) by (pod)
```

3. Set the panel title to the service name, set thresholds: green < 0.7 CPU,
   yellow 0.7–0.9, red > 0.9.
4. **Save dashboard** → name it `RideNow Services`.

---

## Part 4 — Monitor CPU, memory, pod restarts, latency, and HTTP 5xx

### 4.1 CPU threshold guidance

Each pod requests 250m and is capped at 1000m (1 vCPU) by its limit — on Fargate
that request also sets the micro-VM size. A pod sustained near its 1-vCPU limit
is either under-provisioned or in a runaway loop.

```promql
# Services using more than 0.7 CPU cores right now (70% of the 1-vCPU limit)
sum(rate(container_cpu_usage_seconds_total{namespace="ridenow"}[5m])) by (pod)
> 0.7
```

### 4.2 Memory threshold guidance

Each container limit is 1Gi. Watch for working set approaching the limit:

```promql
# Memory usage as % of limit
sum(container_memory_working_set_bytes{namespace="ridenow"}) by (pod)
/
sum(kube_pod_container_resource_limits{resource="memory",namespace="ridenow"}) by (pod)
* 100
```

Values above 80% risk OOMKill.

### 4.3 Pod restart spike detection

```promql
# Pods that restarted in the last 15 minutes
increase(kube_pod_container_status_restarts_total{namespace="ridenow"}[15m]) > 0
```

### 4.4 Request latency p99

```promql
# p99 latency in milliseconds per endpoint
histogram_quantile(0.99,
  sum(rate(http_server_requests_seconds_bucket{namespace="ridenow"}[5m]))
  by (le, uri, pod)
) * 1000
```

Anything above 2000 ms (2s) warrants investigation.

### 4.5 HTTP 5xx error rate

```promql
# 5xx errors as % of total requests
sum(rate(http_server_requests_seconds_count{status=~"5..",namespace="ridenow"}[5m]))
/
sum(rate(http_server_requests_seconds_count{namespace="ridenow"}[5m]))
* 100
```

Above 1% is a problem in production; in a lab, even 1 error is visible here.

---

## Part 5 — CloudWatch dashboards and Logs Insights queries

### 5.1 Create a CloudWatch dashboard

**Console:** CloudWatch → **Dashboards** → **Create dashboard** →
name: `RideNow-EKS`.

Add widgets:
1. **Add widget** → **Logs table** → log group `/aws/eks/ridenow/fargate` (the
   Fargate log router target) → query recent app logs:
   ```sql
   fields @timestamp, @logStream, @message
   | sort @timestamp desc
   | limit 20
   ```
   (On Fargate there is no Container Insights `pod_cpu_utilization` metric — pod
   CPU/memory come from AMP, wired into the Grafana dashboards in Part 3. Use
   Application Signals widgets here for request latency and error rate.)
2. Add a second widget → **Logs table** → log group
   `/aws/eks/ridenow/cluster` → query:
   ```sql
   fields @timestamp, @message
   | filter @logStream like /audit/
   | sort @timestamp desc
   | limit 20
   ```
3. **Save dashboard**.

### 5.2 Logs Insights queries

**Console:** CloudWatch → **Logs Insights** → select log group
`/aws/eks/ridenow/cluster`.

**All DENY / FORBID decisions (RBAC):**
```sql
fields @timestamp, @message
| filter @logStream like /audit/
| filter @message like /forbid|deny/
| sort @timestamp desc
| limit 50
```

**4xx and 5xx API server responses:**
```sql
fields @timestamp, @message
| filter @logStream like /kube-apiserver/
| filter @message like /"status":4|"status":5/
| sort @timestamp desc
| limit 50
```

**Authenticator failures (IAM to k8s identity mapping):**
```sql
fields @timestamp, @message
| filter @logStream like /authenticator/
| filter @message like /error|failed|denied/
| sort @timestamp desc
| limit 50
```

**Scheduler FailedScheduling events:**
```sql
fields @timestamp, @message
| filter @logStream like /scheduler/
| filter @message like /FailedScheduling|insufficient/
| sort @timestamp desc
| limit 50
```

**Controller manager reconcile errors:**
```sql
fields @timestamp, @message
| filter @logStream like /controller/
| filter @message like /error|Error|failed/
| sort @timestamp desc
| limit 50
```

**Correlate logs by pod name across all streams:**
```sql
fields @timestamp, @logStream, @message
| filter @message like /user-service/
| sort @timestamp desc
| limit 100
```

---

## Part 6 — Alerts and SNS email notifications

### 6.1 Create an SNS topic and subscribe your email

```bash
# Create topic
SNS_ARN=$(aws sns create-topic \
  --name ridenow-alerts \
  --region ap-southeast-1 \
  --query TopicArn --output text --no-cli-pager)
echo "SNS ARN: $SNS_ARN"

# Subscribe your email (replace with your address)
aws sns subscribe \
  --topic-arn $SNS_ARN \
  --protocol email \
  --notification-endpoint you@example.com \
  --region ap-southeast-1 \
  --no-cli-pager
```

Check your inbox and click the confirmation link. The subscription status must
be **Confirmed** before alarms can deliver.

### 6.2 Alarms on Fargate — pod signals, not node signals

On Fargate there are no `node_cpu_utilization` / `node_memory_utilization`
metrics (no nodes) and no Container Insights `pod_number_of_container_restarts`
metric (no CloudWatch agent DaemonSet). The reliable signals are **pod-level and
come from AMP** via the agentless scraper and kube-state-metrics — so alerting is
driven by **AMP alerting rules** (6.3), which route to SNS through an alert
manager definition.

Keep the SNS topic from 6.1. Then express each alert as a Prometheus rule rather
than a CloudWatch metric alarm:

| Alert | Prometheus expression (see 6.3) |
|-------|---------------------------------|
| Pod restart / crash-loop | `increase(kube_pod_container_status_restarts_total{namespace="ridenow"}[15m]) > 3` |
| OOMKill | `kube_pod_container_status_last_terminated_reason{reason="OOMKilled",namespace="ridenow"} > 0` |
| High pod memory | `container_memory_working_set_bytes / kube_pod_container_resource_limits{resource="memory"} * 100 > 80` |
| High pod CPU | `rate(container_cpu_usage_seconds_total{namespace="ridenow"}[5m]) > 0.9` |

The only CloudWatch metric alarms worth keeping on Fargate are those built on
data CloudWatch still has natively — e.g. **ALB target 5xx** and **ALB target
response time** (from the ALB, no agent needed):

```bash
# ALB 5xx spike (replace the LoadBalancer dimension with your ALB's ARN suffix)
aws cloudwatch put-metric-alarm \
  --alarm-name "RideNow-ALB-5xx" \
  --alarm-description "ALB returned 5xx responses" \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/k8s-ridenow-xxxx/xxxx \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions $SNS_ARN \
  --region ap-southeast-1 \
  --no-cli-pager
```

Verify in the console: CloudWatch → **Alarms** → the ALB alarm shows **OK**, and
the pod-level rules appear under AMP (6.3).

### 6.3 AMP alerting rule (Prometheus-native)

Create a recording + alerting rule file:

```bash
cat > /tmp/ridenow-rules.yaml <<'EOF'
groups:
  - name: ridenow-pod-alerts
    rules:
      - alert: PodCrashLooping
        expr: |
          increase(kube_pod_container_status_restarts_total{namespace="ridenow"}[15m]) > 3
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }} is crash-looping"
          description: "Pod restarted {{ $value }} times in the last 15 minutes."

      - alert: HighMemoryUsage
        expr: |
          (container_memory_working_set_bytes{namespace="ridenow"}
          / kube_pod_container_resource_limits{resource="memory",namespace="ridenow"})
          * 100 > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High memory on pod {{ $labels.pod }}"
          description: "Memory usage is {{ $value }}% of limit."

      - alert: PodOOMKilled
        expr: |
          kube_pod_container_status_last_terminated_reason{reason="OOMKilled",namespace="ridenow"} > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Pod {{ $labels.pod }} was OOMKilled"
          description: "A container hit its memory limit and was killed."
EOF

# Base64-encode and upload to AMP
RULES_B64=$(base64 -w 0 /tmp/ridenow-rules.yaml)

aws amp create-rule-groups-namespace \
  --workspace-id $WORKSPACE_ID \
  --name ridenow-alerts \
  --data "$RULES_B64" \
  --region ap-southeast-1 \
  --no-cli-pager
```

Verify:
```bash
aws amp list-rule-groups-namespaces \
  --workspace-id $WORKSPACE_ID \
  --region ap-southeast-1 \
  --no-cli-pager \
  --query "ruleGroupsNamespaces[*].[name,status.statusCode]" \
  --output table
```

---

## Part 7 — Service-to-service visibility (Application Signals)

The Network Flow Monitor agent is a DaemonSet and cannot run on Fargate. On
Fargate, service-to-service visibility comes from **Application Signals** (the
sidecar enabled in guide 05), which builds a service map and per-edge latency and
error metrics from the instrumented Spring Boot services — no node-level flow
agent required.

### 7.1 View the service map (after pods are deployed in guide 06)

**Console:** CloudWatch → **Application Signals** → **Service map**.

- Each microservice appears as a node.
- Edges show active calls between them (e.g. driver-service → user-service).
- Click an edge to see request rate, latency (p50/p99), and error rate for that
  dependency.

### 7.2 Service-level objectives (SLOs)

**Console:** CloudWatch → **Application Signals** → **Services** → pick a service
(e.g. `driver-service`) → **Create SLO**. Define, for example, "p99 latency < 500
ms over 99% of a rolling 1-hour window". Breaches raise a CloudWatch alarm you can
wire to the SNS topic from Part 6.

### 7.3 Correlate a dependency call with traces

From any edge on the service map, open **View traces** to drill into individual
request traces spanning multiple services — the Fargate equivalent of following a
single flow end to end.

### 7.4 Generate traffic to populate the map

```bash
# Hit the public ALB a few times to produce cross-service calls
ADDR=$(kubectl get ingress ridenow -n ridenow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
for i in $(seq 1 20); do curl -s "http://$ADDR/api/drivers" >/dev/null; sleep 2; done
```

Wait ~3 min, then refresh the service map — driver-service and its calls to
user-service should appear with latency and error-rate figures.

---

## Part 8 — Investigate control plane log errors

### 8.1 IAM → Kubernetes identity mapping failures (Authenticator)

**Console:** CloudWatch → Logs Insights → `/aws/eks/ridenow/cluster`

```sql
fields @timestamp, @message
| filter @logStream like /authenticator/
| filter @message like /error|failed|not mapped|no identity/
| sort @timestamp desc
| limit 20
```

What to look for: `sts` errors mean a role isn't trusted. `no identity mapping`
means an IAM role isn't mapped to a Kubernetes group. On a Fargate cluster the
Fargate pod execution role is mapped automatically when you create the profiles;
your own admin role and any CI roles still need an access entry.

Fix (preferred — EKS access entries, not the legacy `aws-auth` ConfigMap):
```bash
aws eks create-access-entry \
  --cluster-name ridenow \
  --principal-arn arn:aws:iam::<ACCOUNT_ID>:role/<role> \
  --region ap-southeast-1 --no-cli-pager
```

### 8.2 RBAC denials (Audit)

```sql
fields @timestamp, @message
| filter @logStream like /audit/
| filter @message like /forbid|Forbidden/
| parse @message '"user":{"username":"*"' as username
| parse @message '"verb":"*"' as verb
| parse @message '"resource":"*"' as resource
| sort @timestamp desc
| limit 30
```

This shows who was denied, what they tried to do, and on what resource.

### 8.3 Scheduling failures (Scheduler)

```sql
fields @timestamp, @message
| filter @logStream like /scheduler/
| filter @message like /FailedScheduling|Insufficient|Unschedulable/
| sort @timestamp desc
| limit 20
```

Common causes on Fargate: the pod's namespace has **no matching Fargate profile**
(so nothing can place it), or the requested CPU/memory exceeds the largest
Fargate task size. There is no "node out of capacity" case — each pod gets its
own micro-VM.

Fix — confirm a profile matches the pod's namespace:
```bash
aws eks list-fargate-profiles --cluster-name ridenow \
  --region ap-southeast-1 --no-cli-pager
# then describe one to see its namespace selectors
aws eks describe-fargate-profile --cluster-name ridenow \
  --fargate-profile-name ridenow-app --region ap-southeast-1 --no-cli-pager
```

### 8.4 API server 5xx errors

```sql
fields @timestamp, @message
| filter @logStream like /kube-apiserver/
| filter @message like /"code":5/
| sort @timestamp desc
| limit 20
```

### 8.5 Controller reconcile errors

```sql
fields @timestamp, @message
| filter @logStream like /controller/
| filter @message like /error|Error|failed to|unable to/
| sort @timestamp desc
| limit 20
```

---

## Part 9 — Simulate failures and verify detection

> Run every simulation pod in the **`ridenow`** namespace — it's the one with a
> Fargate profile, so pods actually schedule. A pod in `default` would stay
> `Pending` forever (no matching profile).

### Simulation 1: CrashLoopBackOff → pod restart alert

```bash
kubectl run crasher -n ridenow --image=busybox --restart=Always -- /bin/sh -c "exit 1"
```

Wait 2 min:
```bash
kubectl get pod crasher -n ridenow
# Expected: STATUS = CrashLoopBackOff

kubectl describe pod crasher -n ridenow
# Expected: Events show "Back-off restarting failed container"
```

**Verify in AMP (Grafana Explore):**
```promql
kube_pod_container_status_restarts_total{pod="crasher"}
```
Counter increments every ~30 seconds.

**Verify the alert:** the `PodCrashLooping` AMP rule (Part 6.3) fires once restarts
exceed its threshold and delivers to SNS → you receive an email.

**Verify in Logs Insights** (Scheduler log):
```sql
fields @timestamp, @message
| filter @logStream like /scheduler/
| filter @message like /crasher/
| sort @timestamp desc
```

```bash
kubectl delete pod crasher -n ridenow
```

---

### Simulation 2: OOMKill → memory alert

```bash
kubectl run oomtest -n ridenow \
  --image=polinux/stress \
  --requests='memory=50Mi' \
  --limits='memory=50Mi' \
  -- stress --vm 1 --vm-bytes 100M --vm-hang 0
```

```bash
kubectl get pod oomtest -n ridenow
# Expected: STATUS = OOMKilled

kubectl describe pod oomtest -n ridenow
# Expected: Last State: Terminated  Reason: OOMKilled
```

**Verify in AMP** (also fires the `PodOOMKilled` rule from Part 6.3):
```promql
kube_pod_container_status_last_terminated_reason{reason="OOMKilled",pod="oomtest"}
```

**Verify in Logs Insights** (Controller manager):
```sql
fields @timestamp, @message
| filter @logStream like /controller/
| filter @message like /oomtest/
| sort @timestamp desc
```

```bash
kubectl delete pod oomtest -n ridenow
```

---

### Simulation 3: Forbidden RBAC call → audit log

```bash
kubectl auth can-i delete pods --as system:serviceaccount:default:default
# Expected output: no
```

**Verify in Logs Insights:**
```sql
fields @timestamp, @message
| filter @logStream like /audit/
| filter @message like /forbid/
| filter @message like /system:serviceaccount:default:default/
| sort @timestamp desc
| limit 5
```

---

### Simulation 4: Bad API request → API server log

```bash
kubectl get pods -n does-not-exist
# Expected: Error from server (NotFound)
```

**Verify in Logs Insights:**
```sql
fields @timestamp, @message
| filter @logStream like /kube-apiserver/
| filter @message like /does-not-exist/
| sort @timestamp desc
| limit 5
```

---

### Simulation 5: Pod CPU spike → high-CPU alert

There are no nodes to stress on Fargate — each pod has its own micro-VM — so this
is a **pod-level** CPU test. The stress pod requests 250m but is allowed to burn
up to its 800m limit, which the AMP high-CPU rule detects.

```bash
kubectl run cpustress -n ridenow \
  --image=polinux/stress \
  --requests='cpu=250m' \
  --limits='cpu=800m' \
  -- stress --cpu 4 --timeout 120s
```

While it runs, watch the pod (not a node):
```bash
kubectl top pod cpustress -n ridenow
# CPU climbs toward the 800m limit
```

**Verify in AMP:**
```promql
sum(rate(container_cpu_usage_seconds_total{pod="cpustress"}[1m])) by (pod)
```

**Verify the alert:** the high-pod-CPU AMP rule (Part 6.2 table) transitions to
firing once the pod sustains > 0.7 cores, and delivers to SNS.

```bash
kubectl delete pod cpustress -n ridenow
```

---

## Verify checklist

- [ ] AMP workspace `ridenow_workspace` **Active** and one agentless scraper **ACTIVE**.
- [ ] Fargate log router applied; `/aws/eks/ridenow/fargate` log group receiving pod logs.
- [ ] `metrics-server` and `kube-state-metrics` Deployments **Running** on Fargate.
- [ ] 5 control plane log streams in `/aws/eks/ridenow/cluster` with recent entries.
- [ ] Application Signals service map shows the services and their calls.
- [ ] Grafana connected to AMP, `up` query returns results.
- [ ] RideNow Services dashboard shows CPU/memory per pod.
- [ ] ALB 5xx CloudWatch alarm in **OK**; AMP alert rules (`ridenow-alerts`) **ACTIVE**.
- [ ] SNS email subscription **Confirmed**.
- [ ] At least 2 simulations from Part 9 triggered visible evidence in logs or metrics.

---

## Clean up observability resources

```bash
# Disable all five control plane logs
aws eks update-cluster-config \
  --name ridenow \
  --region ap-southeast-1 \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":false}]}'

# Delete the control-plane and Fargate log groups (stops storage charges)
aws logs delete-log-group \
  --log-group-name /aws/eks/ridenow/cluster \
  --region ap-southeast-1 --no-cli-pager
aws logs delete-log-group \
  --log-group-name /aws/eks/ridenow/fargate \
  --region ap-southeast-1 --no-cli-pager

# Delete the ALB CloudWatch alarm
aws cloudwatch delete-alarms \
  --alarm-names RideNow-ALB-5xx \
  --region ap-southeast-1 --no-cli-pager

# Delete SNS topic
aws sns delete-topic --topic-arn $SNS_ARN \
  --region ap-southeast-1 --no-cli-pager

# Delete AMP alert rules
aws amp delete-rule-groups-namespace \
  --workspace-id $WORKSPACE_ID \
  --name ridenow-alerts \
  --region ap-southeast-1 --no-cli-pager
```

Delete the Grafana deployment if you no longer need it:
```bash
kubectl delete namespace grafana
```

Next: `07-later-elasticache-redis.md`.
