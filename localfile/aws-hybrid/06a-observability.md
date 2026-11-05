# 06a - Observability: verify, explore, and trigger test errors

Goal: confirm that everything enabled in the Part A½ observability screen is
actually working, understand what each console screen shows, and trigger a few
deliberate errors so you can see what a real alert looks like before your app
is deployed.

Time: ~20 min. Cost: log ingestion + Network Flow Monitor flow records (small
at lab scale; see cost note in `06-eks-cluster.md`).

---

## What was enabled and where to find it

| What | AWS console path | Charges |
|------|-----------------|---------|
| Prometheus metrics (ADOT → AMP) | **Amazon Managed Service for Prometheus** → Workspaces | per sample ingested |
| Network Flow Monitor | **CloudWatch** → **Network monitoring** → Monitors → `ridenow-dev` | per flow record |
| Control plane logs (all 5) | **CloudWatch** → **Log groups** → `/aws/eks/ridenow/cluster` | per GB ingested |

---

## Part 1 - Confirm the ADOT Prometheus collector is running

```bash
# The ADOT daemonset is installed in the amazon-cloudwatch or adot-col-* namespace
kubectl get pods -A | grep -E "adot|otel|prometheus"
```

You should see one pod per node in `Running` state. If nothing appears, the
add-on may still be installing — wait 2 min and retry.

---

## Part 2 - Confirm control plane logs are flowing

1. Console → **CloudWatch** → **Log groups**.
2. Search for `/aws/eks/ridenow/cluster`. You should see five log streams, one
   per log type (`kube-apiserver-*`, `kube-audit-*`, `authenticator-*`,
   `kube-controller-manager-*`, `kube-scheduler-*`). They may take 5–10 min
   after cluster creation to appear.
3. Click the **audit** stream — you will already see entries from your own
   `kubectl get nodes` commands run in Part C of guide 06.

---

## Part 3 - Confirm Network Flow Monitor is active

1. Console → **CloudWatch** → **Network monitoring** → **Monitors**.
2. Click `ridenow-dev`. The **Service map** tab shows the EKS cluster as a local
   resource. It will show "No data" until pods are running (guide 07).
3. The **Flow table** tab lists individual flows once traffic exists.

---

## Part 4 - Trigger errors and observe them

### Error 1: forbidden API call → Audit log

Run a kubectl command impersonating a restricted service account:

```bash
kubectl auth can-i delete pods --as system:serviceaccount:default:default
```

Expected output: `no`

**Where to see it:**
CloudWatch → Log groups → `/aws/eks/ridenow/cluster` → `kube-audit-*`
→ filter for `"verb":"delete"` and `"decision":"forbid"`.

---

### Error 2: bad namespace → API server log

```bash
kubectl get pods -n does-not-exist
```

Expected output: `Error from server (NotFound): ...`

**Where to see it:**
CloudWatch → Log groups → `/aws/eks/ridenow/cluster` → `kube-apiserver-*`
→ filter for `does-not-exist` or HTTP `404`.

---

### Error 3: CrashLoopBackOff pod → Prometheus metric + scheduler log

Deploy a pod that immediately exits:

```bash
kubectl run crasher \
  --image=busybox \
  --restart=Always \
  -- /bin/sh -c "exit 1"
```

Wait ~60 seconds then check:

```bash
kubectl get pod crasher
# STATUS: CrashLoopBackOff

kubectl describe pod crasher
# Events section shows: Back-off restarting failed container
```

**Where to see it in AMP:** query
`kube_pod_container_status_restarts_total{pod="crasher"}` — the counter climbs
with each restart.

**Where to see it in control plane logs:**
CloudWatch → `kube-scheduler-*` stream → filter for `crasher` to see scheduling
decisions each time Kubernetes tries to restart it.

Clean up:

```bash
kubectl delete pod crasher
```

---

### Error 4: OOMKilled pod → node-level Prometheus metric

Deploy a pod that allocates more memory than its limit:

```bash
kubectl run oomtest \
  --image=polinux/stress \
  --requests='memory=50Mi' \
  --limits='memory=50Mi' \
  -- stress --vm 1 --vm-bytes 100M --vm-hang 0
```

The pod is OOMKilled within seconds:

```bash
kubectl get pod oomtest
# STATUS: OOMKilled  (or CrashLoopBackOff after the first kill)

kubectl describe pod oomtest
# Last State: Terminated  Reason: OOMKilled
```

**Where to see it in AMP:** query
`kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`.

**Where to see it in control plane logs:**
CloudWatch → `kube-controller-manager-*` → filter for `oomtest`.

Clean up:

```bash
kubectl delete pod oomtest
```

---

### Error 5: pod-to-pod traffic → Network Flow Monitor

```bash
# Deploy two pods and curl between them
kubectl run server --image=nginx --expose --port=80
kubectl run client --image=curlimages/curl --restart=Never \
  -- curl -s http://server
```

Wait 2 min then check:
Console → CloudWatch → Network monitoring → `ridenow-dev` → **Flow table**
→ filter by source/destination matching the pod CIDRs. You will see the
`client → server` flow with latency and byte counts.

Clean up:

```bash
kubectl delete pod client server
kubectl delete service server
```

---

## Part 5 - Useful CloudWatch Logs Insights queries

Console → **CloudWatch** → **Logs Insights** → select log group
`/aws/eks/ridenow/cluster`, then try:

```sql
-- All DENY/FORBID decisions in the last hour
fields @timestamp, @message
| filter @logStream like /audit/
| filter @message like /forbid|deny/
| sort @timestamp desc
| limit 50
```

```sql
-- All 4xx and 5xx API server responses
fields @timestamp, @message
| filter @logStream like /kube-apiserver/
| filter @message like /"status":4|"status":5/
| sort @timestamp desc
| limit 50
```

```sql
-- Scheduler decisions for a specific pod
fields @timestamp, @message
| filter @logStream like /scheduler/
| filter @message like /crasher/
| sort @timestamp desc
```

---

## Verify

- CloudWatch → Log groups → `/aws/eks/ridenow/cluster` has 5 streams with
  recent entries.
- ADOT pods running: `kubectl get pods -A | grep -E "adot|otel"` shows
  `Running`.
- Network Flow Monitor `ridenow-dev` exists and shows the cluster as a local
  resource.
- You triggered at least one error from Part 4 and found it in the logs.

---

## Clean up observability resources (when done with the lab)

```bash
# Disable all five control plane logs
aws eks update-cluster-config \
  --name ridenow \
  --region ap-southeast-1 \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":false}]}'

# Delete the log group (stops storage charges)
aws logs delete-log-group \
  --log-group-name /aws/eks/ridenow/cluster \
  --region ap-southeast-1
```

To delete the Network Flow Monitor:
Console → CloudWatch → Network monitoring → Monitors → `ridenow-dev` → **Delete**.

Next: `07-eks-deploy.md`.
