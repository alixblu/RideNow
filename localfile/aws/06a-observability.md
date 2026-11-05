# 06a - Observability: verify, configure, and monitor RideNow on EKS

Goal: get every observability component working, build dashboards, configure
alerts, and run deliberate failure simulations so you know monitoring is
detecting real problems before your app goes to production.

Time: ~60–90 min end-to-end (Grafana setup and alert wiring take the longest).

---

## Cost summary

| Component | Meter | Rough lab cost |
|-----------|-------|----------------|
| AMP | per sample ingested + per query | ~$0.10–0.30/day at lab scale |
| CloudWatch Container Insights (OTel) | per metric + per log GB | ~$0.05–0.20/day |
| Application Signals | per trace + per metric | ~$0.05–0.15/day |
| Network Flow Monitor | per flow record | ~$0.01–0.05/day |
| Control plane logs (5 types) | per GB ingested | ~$0.10–0.40/day |
| CloudWatch alarms | per alarm per month | $0.10/alarm/month |
| SNS email | first 1000 free | $0 for lab |

All costs are for `ap-southeast-1`. Disable or delete everything in the cleanup
section when you stop the lab.

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

Confirm these are installed (they should be from the cluster creation screen):

```bash
aws eks list-addons --cluster-name ridenow --region ap-southeast-1 \
  --no-cli-pager --output table
```

Expected add-ons: `amazon-cloudwatch-observability`, `adot` (or the AMP scraper
appears as a scraper resource rather than an add-on — check Part 1).

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

## Part 1 — Verify all 5 observability components are active

### 1.1 AMP workspace + scraper

**Console:** Amazon Managed Service for Prometheus → Workspaces → click
`ridenow_workspace`.
- Status should be **Active**.
- Copy the **Endpoint - remote write URL** (you will need it in Part 2).

**Console:** EKS → `ridenow` cluster → **Observability** tab → **Scrapers** →
confirm `ridenow_scraper` status is **Active**.

**CLI:**
```bash
aws amp list-workspaces --region ap-southeast-1 --no-cli-pager \
  --query "workspaces[*].[alias,status.statusCode,workspaceId]" --output table
```

Expected output: one row with alias `ridenow_workspace` and status `ACTIVE`.

### 1.2 ADOT / OTel collector pods

```bash
kubectl get pods -A | grep -E "adot|otel|cloudwatch-agent|amazon-cloudwatch"
```

Expected: one pod per node (2 pods total) in `Running` state. The namespace is
typically `amazon-cloudwatch`.

If no pods appear:
```bash
aws eks describe-addon \
  --cluster-name ridenow \
  --addon-name amazon-cloudwatch-observability \
  --region ap-southeast-1 \
  --no-cli-pager \
  --query "addon.[addonName,status,configurationValues]"
```

### 1.3 Application Signals

```bash
kubectl get pods -n amazon-cloudwatch | grep -i signals
```

Also check the add-on status in the console: EKS → `ridenow` → **Add-ons** →
`amazon-cloudwatch-observability` → status **Active**.

### 1.4 Network Flow Monitor

**Console:** CloudWatch → **Network monitoring** → **Monitors** → click
`ridenow-dev`.
- **Status**: Active.
- **Service map** tab: shows the EKS cluster as a local resource. Will show
  "No data" until pods are running — this is expected at this stage.

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
   provider: **AWS SDK Default** (uses the node role; no keys needed).
4. **Save & test** → should return "Data source is working".

### 2.4 Core PromQL queries

Use these in Grafana **Explore** (or the AMP console **Query editor**):

```promql
# CPU usage per pod (millicores)
sum(rate(container_cpu_usage_seconds_total{namespace="default"}[5m])) by (pod)

# Memory usage per pod (bytes)
sum(container_memory_working_set_bytes{namespace="default"}) by (pod)

# Pod restart count (all namespaces)
sum(kube_pod_container_status_restarts_total) by (pod, namespace)

# HTTP 5xx error rate per service (requires Spring Boot Actuator)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) by (uri, pod)

# HTTP request latency p99 per service
histogram_quantile(0.99,
  sum(rate(http_server_requests_seconds_bucket{namespace="default"}[5m]))
  by (le, pod, uri)
)

# Pod count per service
count(kube_pod_info{namespace="default"}) by (pod)
```

---

## Part 3 — Grafana dashboards

### 3.1 Import the community EKS dashboard

1. Grafana → **Dashboards** → **Import**.
2. Enter dashboard ID **17119** → **Load**.
3. Select your AMP data source → **Import**.

This gives you a pre-built EKS cluster overview: node CPU/memory, pod counts,
network I/O, and persistent volume stats.

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

On `t3.medium` nodes (2 vCPU each), each service should stay below 0.5 CPU
cores under normal load. Above 1.5 cores per pod is a sign of a runaway loop.

```promql
# Services using more than 0.5 CPU cores right now
sum(rate(container_cpu_usage_seconds_total{namespace="default"}[5m])) by (pod)
> 0.5
```

### 4.2 Memory threshold guidance

Each service is allocated ~256Mi by default. Watch for working set approaching
the limit:

```promql
# Memory usage as % of limit
sum(container_memory_working_set_bytes{namespace="default"}) by (pod)
/
sum(kube_pod_container_resource_limits{resource="memory",namespace="default"}) by (pod)
* 100
```

Values above 80% risk OOMKill.

### 4.3 Pod restart spike detection

```promql
# Pods that restarted in the last 15 minutes
increase(kube_pod_container_status_restarts_total{namespace="default"}[15m]) > 0
```

### 4.4 Request latency p99

```promql
# p99 latency in milliseconds per endpoint
histogram_quantile(0.99,
  sum(rate(http_server_requests_seconds_bucket{namespace="default"}[5m]))
  by (le, uri, pod)
) * 1000
```

Anything above 2000 ms (2s) warrants investigation.

### 4.5 HTTP 5xx error rate

```promql
# 5xx errors as % of total requests
sum(rate(http_server_requests_seconds_count{status=~"5..",namespace="default"}[5m]))
/
sum(rate(http_server_requests_seconds_count{namespace="default"}[5m]))
* 100
```

Above 1% is a problem in production; in a lab, even 1 error is visible here.

---

## Part 5 — CloudWatch dashboards and Logs Insights queries

### 5.1 Create a CloudWatch dashboard

**Console:** CloudWatch → **Dashboards** → **Create dashboard** →
name: `RideNow-EKS`.

Add widgets:
1. **Add widget** → **Explorer** → choose **EKS** → select cluster `ridenow` →
   metrics: `pod_cpu_utilization`, `pod_memory_utilization` → **Create widget**.
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

### 6.2 CloudWatch alarms

**Alarm 1: Pod restart spike**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "RideNow-PodRestartSpike" \
  --alarm-description "A pod restarted more than 3 times in 5 min" \
  --namespace ContainerInsights \
  --metric-name pod_number_of_container_restarts \
  --dimensions Name=ClusterName,Value=ridenow \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions $SNS_ARN \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Alarm 2: Node CPU above 80%**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "RideNow-NodeCPUHigh" \
  --alarm-description "Node CPU above 80% for 5 min" \
  --namespace ContainerInsights \
  --metric-name node_cpu_utilization \
  --dimensions Name=ClusterName,Value=ridenow \
  --statistic Average \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 80 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions $SNS_ARN \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Alarm 3: Node memory above 80%**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "RideNow-NodeMemoryHigh" \
  --alarm-description "Node memory above 80% for 5 min" \
  --namespace ContainerInsights \
  --metric-name node_memory_utilization \
  --dimensions Name=ClusterName,Value=ridenow \
  --statistic Average \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 80 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions $SNS_ARN \
  --region ap-southeast-1 \
  --no-cli-pager
```

**Alarm 4: OOMKill detected**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "RideNow-OOMKill" \
  --alarm-description "A container was OOMKilled" \
  --namespace ContainerInsights \
  --metric-name pod_number_of_container_restarts \
  --dimensions Name=ClusterName,Value=ridenow \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions $SNS_ARN \
  --region ap-southeast-1 \
  --no-cli-pager
```

Verify alarms in the console: CloudWatch → **Alarms** → confirm all four show
status **OK** (green).

### 6.3 AMP alerting rule (Prometheus-native)

Create a recording + alerting rule file:

```bash
cat > /tmp/ridenow-rules.yaml <<'EOF'
groups:
  - name: ridenow-pod-alerts
    rules:
      - alert: PodCrashLooping
        expr: |
          increase(kube_pod_container_status_restarts_total{namespace="default"}[15m]) > 3
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }} is crash-looping"
          description: "Pod restarted {{ $value }} times in the last 15 minutes."

      - alert: HighMemoryUsage
        expr: |
          (container_memory_working_set_bytes{namespace="default"}
          / kube_pod_container_resource_limits{resource="memory",namespace="default"})
          * 100 > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High memory on pod {{ $labels.pod }}"
          description: "Memory usage is {{ $value }}% of limit."
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

## Part 7 — Network Flow Monitor: service-to-service communication

### 7.1 View the service map (after pods are deployed in guide 07)

**Console:** CloudWatch → **Network monitoring** → **Monitors** →
`ridenow-dev` → **Service map** tab.

- Each microservice appears as a node.
- Arrows show active connections between them.
- Click an arrow to see latency, packet loss, and byte counts for that flow.

### 7.2 Flow table — filter by namespace CIDR

Your private subnets are `10.10.48.0/20` and `10.10.64.0/20`. Pod IPs fall in
these ranges.

**Console:** `ridenow-dev` → **Flow table** tab → filter:
- Source: `10.10.48.0/20` or `10.10.64.0/20`
- Time range: last 1 hour

Each row shows: source IP, destination IP, protocol, bytes sent, retransmits,
and RTT.

### 7.3 Identify unexpected outbound flows

Filter the flow table for destination IPs outside your VPC CIDR (`10.10.0.0/16`).
Any traffic to external IPs that you didn't configure is worth investigating.

### 7.4 Test service-to-service flow visibility

```bash
# Deploy a temporary nginx server and client to generate a known flow
kubectl run flow-server --image=nginx --expose --port=80
kubectl run flow-client --image=curlimages/curl --restart=Never \
  -- sh -c "for i in $(seq 1 20); do curl -s http://flow-server; sleep 2; done"
```

Wait 3 min, then check the flow table. You should see the flow-client →
flow-server flow with RTT and byte counts.

```bash
# Clean up
kubectl delete pod flow-client flow-server
kubectl delete service flow-server
```

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

What to look for: `sts` errors mean the node role isn't trusted. `no identity
mapping` means the IAM role isn't in the `aws-auth` ConfigMap.

Fix:
```bash
kubectl edit configmap aws-auth -n kube-system
# Add missing roleArn → groups mapping
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

Common causes: nodes out of CPU/memory, missing node selector, taint not
tolerated.

Fix — check node resources:
```bash
kubectl describe nodes | grep -A 5 "Allocated resources"
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

### Simulation 1: CrashLoopBackOff → pod restart alarm

```bash
kubectl run crasher --image=busybox --restart=Always -- /bin/sh -c "exit 1"
```

Wait 2 min:
```bash
kubectl get pod crasher
# Expected: STATUS = CrashLoopBackOff

kubectl describe pod crasher
# Expected: Events show "Back-off restarting failed container"
```

**Verify in AMP (Grafana Explore):**
```promql
kube_pod_container_status_restarts_total{pod="crasher"}
```
Counter increments every ~30 seconds.

**Verify CloudWatch alarm:** CloudWatch → Alarms → `RideNow-PodRestartSpike`
→ should transition to **In alarm** → you receive an SNS email.

**Verify in Logs Insights** (Scheduler log):
```sql
fields @timestamp, @message
| filter @logStream like /scheduler/
| filter @message like /crasher/
| sort @timestamp desc
```

```bash
kubectl delete pod crasher
```

---

### Simulation 2: OOMKill → memory alarm

```bash
kubectl run oomtest \
  --image=polinux/stress \
  --requests='memory=50Mi' \
  --limits='memory=50Mi' \
  -- stress --vm 1 --vm-bytes 100M --vm-hang 0
```

```bash
kubectl get pod oomtest
# Expected: STATUS = OOMKilled

kubectl describe pod oomtest
# Expected: Last State: Terminated  Reason: OOMKilled
```

**Verify in AMP:**
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
kubectl delete pod oomtest
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

### Simulation 5: Node CPU spike → CPU alarm

Run a CPU stress pod (safe — runs briefly, does not affect your services):

```bash
kubectl run cpustress \
  --image=polinux/stress \
  --requests='cpu=100m' \
  --limits='cpu=800m' \
  -- stress --cpu 4 --timeout 120s
```

While it runs:
```bash
kubectl top nodes
# Watch the CPU % climb on one node
```

**Verify in AMP:**
```promql
sum(rate(container_cpu_usage_seconds_total{pod="cpustress"}[1m])) by (pod)
```

**Verify CloudWatch alarm:** `RideNow-NodeCPUHigh` may transition to **In alarm**
depending on how much headroom the node has.

```bash
kubectl delete pod cpustress
```

---

## Verify checklist

- [ ] AMP workspace `ridenow_workspace` status **Active**.
- [ ] ADOT/OTel pods running: `kubectl get pods -A | grep -E "adot|otel"` → `Running`.
- [ ] 5 control plane log streams in `/aws/eks/ridenow/cluster` with recent entries.
- [ ] Network Flow Monitor `ridenow-dev` status **Active**.
- [ ] Grafana connected to AMP, `up` query returns results.
- [ ] RideNow Services dashboard shows CPU/memory for each service.
- [ ] 4 CloudWatch alarms in **OK** state.
- [ ] SNS email subscription **Confirmed**.
- [ ] AMP alert rules uploaded (`ridenow-alerts` namespace **ACTIVE**).
- [ ] At least 2 simulations from Part 9 triggered visible evidence in logs or metrics.

---

## Clean up observability resources (when done with the lab)

```bash
# Disable all five control plane logs
aws eks update-cluster-config \
  --name ridenow \
  --region ap-southeast-1 \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":false}]}'

# Delete the CloudWatch log group (stops storage charges)
aws logs delete-log-group \
  --log-group-name /aws/eks/ridenow/cluster \
  --region ap-southeast-1 \
  --no-cli-pager

# Delete CloudWatch alarms
aws cloudwatch delete-alarms \
  --alarm-names RideNow-PodRestartSpike RideNow-NodeCPUHigh \
                RideNow-NodeMemoryHigh RideNow-OOMKill \
  --region ap-southeast-1 \
  --no-cli-pager

# Delete SNS topic
aws sns delete-topic --topic-arn $SNS_ARN \
  --region ap-southeast-1 --no-cli-pager

# Delete AMP alert rules
aws amp delete-rule-groups-namespace \
  --workspace-id $WORKSPACE_ID \
  --name ridenow-alerts \
  --region ap-southeast-1 \
  --no-cli-pager
```

Delete the Network Flow Monitor:
Console → CloudWatch → Network monitoring → Monitors → `ridenow-dev` → **Delete**.

Delete the Grafana deployment if you no longer need it:
```bash
kubectl delete namespace grafana
```

Next: `07-eks-deploy.md`.
