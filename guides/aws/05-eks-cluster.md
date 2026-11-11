# 05 - EKS: create the cluster and connect to it (the main event)

Goal: an Amazon EKS cluster running pods on **AWS Fargate** (serverless — no EC2
node group), in the private subnets from guide 02, using the roles from guide 01.
Then connect `kubectl` so you can deploy in guide 06.

Time: ~20 min (the control plane takes ~10-15 min to provision; Fargate profiles
are quick). Cost: the **EKS control plane bills per hour** the moment it exists.
Fargate itself only bills once pods are scheduled (guide 06), per pod
vCPU/memory-second. The control plane is the thing to delete when you stop.

---

## Part A - Create the cluster (control plane)

1. Console -> **EKS** -> **Clusters** -> **Create cluster**.
2. **Configuration options**: **Custom configuration**. Turn **off** "Use EKS
   Auto Mode" for this guide (we create our own Fargate profiles so the steps are
   explicit and match the manifests).
3. **Name**: `ridenow`.
4. **Kubernetes version**: accept the default (latest stable).
5. **Cluster service role**: pick **`ridenow-eks-cluster-role`** (from guide 01).
6. **Next**.
7. **Networking**:
   - VPC: the `ridenow` VPC.
   - Subnets: select the **three private** subnets (where Fargate pods run) and
     the **three public** subnets (so a public ALB can attach). If unsure, select
     all six.
   - Cluster endpoint access: **Public and private** (you reach the API from your
     laptop; pods reach it privately). Tighten to private-only for a locked-down
     production posture.
8. **Next** → review → **Create**. Wait until the cluster **Status** is
   **Active** (~10 min).

---

## Part A½ - Configure observability (screen after cluster config)

After the cluster config, the console presents a **Configure observability**
screen. **Fargate changes what works here:** the Prometheus/CloudWatch options on
this screen install **DaemonSet-based** collectors (ADOT, the CloudWatch agent,
the Network Flow Monitor agent), and DaemonSets do not run on Fargate — there are
no nodes to place one pod per. So most of this screen is wired up differently
after the cluster exists, in `06a-observability.md`:

### Metrics — leave the DaemonSet collectors OFF

- **Prometheus**: **leave disabled** here. On Fargate you use the **AMP
  agentless scraper** instead of the ADOT DaemonSet — set up in
  `06a-observability.md` Part 1. It scrapes pod `/actuator/prometheus` endpoints
  with no in-cluster agent.
- **CloudWatch Container Insights**: **leave disabled** here (it's a DaemonSet
  agent). Fargate pod metrics come from the **Fargate log router** and the AMP
  scraper instead.
- **Application Signals**: you may still **Enable** it — on Fargate it attaches a
  sidecar to each pod (not a DaemonSet), so APM traces/latency/error rate work.

### Container network observability

- **Network monitoring**: **leave disabled**. The Network Flow Monitor agent is a
  DaemonSet and cannot run on Fargate. Pod-to-pod visibility comes from
  Application Signals and the service map instead.

### Control plane logs

Enable **all five** — these are emitted by the control plane itself, unaffected by
Fargate. They land in CloudWatch Logs under `/aws/eks/ridenow/cluster`.

- ✓ **API server** — every API request (kubectl, controllers, pod creation)
- ✓ **Audit** — authentication and authorization decisions
- ✓ **Authenticator** — IAM-to-Kubernetes identity mapping
- ✓ **Controller manager** — reconciliation loops (deployments, replica sets)
- ✓ **Scheduler** — pod placement decisions

> **Cost note**: all five control-plane logs generate roughly 200–800 MB/day
> (~$0.10–0.40/day at $0.50/GB in ap-southeast-1). See `06a-observability.md` for
> the Fargate observability setup (AMP scraper + Fargate log router).

Click **Next** to proceed to the add-on screen.

---

## Part A¾ - Select add-ons (screen after Configure observability)

The console shows a full add-on catalogue. On Fargate, keep only the add-ons that
run as Deployments or are built into Fargate; **skip every DaemonSet-based agent**
(it can't schedule without nodes). Leave everything else (SageMaker, FSx, SR-IOV,
GuardDuty, Marketplace) off:

| Add-on | Default | Action on Fargate |
|--------|---------|-------------------|
| **Amazon VPC CNI** | ✓ pre-selected | Keep — pod networking. On Fargate it's built in (native ENI per pod); the add-on is harmless to leave |
| **CoreDNS** | ✓ pre-selected | Keep — in-cluster DNS, required. **Must be patched to run on Fargate** (Part B below) |
| **kube-proxy** | ✓ pre-selected | **Skip / N/A** — not used on Fargate (no nodes to program iptables) |
| **Amazon CloudWatch Observability** | ✓ pre-selected | **Skip** — DaemonSet agent, won't run on Fargate. Logs go via the Fargate log router (`06a`) |
| **AWS Network Flow Monitor Agent** | ✓ pre-selected | **Skip** — DaemonSet agent, won't run on Fargate |
| **Amazon EKS Pod Identity Agent** | ✓ pre-selected | Keep — lets pods assume IAM roles via service accounts (ALB controller, External Secrets in guide 06) |
| **Metrics Server** | ✓ pre-selected | Keep — runs as a Deployment on Fargate; required for HPA |
| **AWS Distro for OpenTelemetry** | ✗ not default | **Skip** — ADOT collector is a DaemonSet. Use the AMP agentless scraper instead (`06a`) |
| **AWS Secrets Store CSI Driver Provider** | ✗ not default | Optional — only if you mount secrets as files. This guide uses External Secrets (`06`) instead |
| **Kube State Metrics** | ✗ not default | **Add** — runs as a Deployment; exposes Kubernetes object metrics (pod restarts, replica counts) for the PromQL queries in `06a-observability.md` |

Click **Next** → configure add-on versions: accept the defaults → **Next** →
**Create**. The cluster will move to **Active** in ~10 min.

---

## Part B - Create Fargate profiles

Fargate runs each pod on its own right-sized micro-VM. A **Fargate profile** tells
EKS "pods in these namespaces run on Fargate". You need three profiles, all using
the **Fargate pod execution role** from guide 01 and the **three private**
subnets.

1. Open the `ridenow` cluster -> **Compute** tab -> **Fargate profiles** ->
   **Add Fargate profile**.
2. Create the **app** profile:
   - **Name**: `ridenow-app`.
   - **Pod execution role**: `ridenow-eks-fargate-pod-execution-role` (guide 01).
   - **Subnets**: the **three private** subnets only (pods must not be publicly
     addressable; they reach out via the per-AZ NAT gateways).
   - **Next** -> **Namespaces**: add `ridenow`. **Next** -> **Create**.
3. Repeat for the **system** profile:
   - **Name**: `ridenow-system`.
   - Same role and subnets.
   - **Namespaces**: add `kube-system` **and** `external-secrets`.
4. Repeat for the **observability** profile:
   - **Name**: `ridenow-observability`.
   - Same role and subnets.
   - **Namespaces**: add `aws-observability`.

Each profile reaches **Active** in ~1-2 min.

### Patch CoreDNS to run on Fargate

CoreDNS ships with an annotation that pins it to EC2 compute. With no nodes, its
pods stay `Pending` until you remove that annotation so the `kube-system` Fargate
profile can place them:

```bash
kubectl patch deployment coredns \
  -n kube-system \
  --type=json \
  -p='[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'

kubectl rollout restart deployment coredns -n kube-system
kubectl rollout status deployment coredns -n kube-system
```

Once this completes, CoreDNS runs on Fargate and in-cluster DNS works.

---

## Part C - Connect kubectl from your laptop

1. Make sure the AWS CLI is configured as `ridenow-admin` (`aws sts
   get-caller-identity` returns your account).
2. Update your kubeconfig so `kubectl` talks to the cluster:

   ```bash
   aws eks update-kubeconfig --name ridenow --region ap-southeast-1
   ```

3. Confirm you're connected. On Fargate there are no persistent nodes — a node
   only appears (as a `fargate-...` virtual node) once a pod is scheduled onto it.
   With nothing deployed yet, check the control plane and CoreDNS instead:

   ```bash
   kubectl get svc kubernetes          # the API server ClusterIP = you're connected
   kubectl get pods -n kube-system     # coredns pods Running on Fargate after the patch
   # NAME                       READY   STATUS    RESTARTS   AGE
   # coredns-xxxxxxxxxx-xxxxx    1/1     Running   0          2m
   ```

   Once you deploy services in guide 06, `kubectl get nodes` will list one
   `fargate-ip-...` virtual node per running pod. A reachable API server plus
   CoreDNS `Running` on Fargate = the cluster is live and you're connected.

---

## Part D - Enable the OIDC provider (needed by guide 06 and the later ops)

Pods that need AWS permissions (the ALB controller in guide 06; External Secrets
and the SQS/EventBridge access in the later ops) use **IRSA**, which requires an
OIDC identity provider associated with the cluster.

1. EKS -> `ridenow` cluster -> **Overview** -> copy the **OpenID Connect provider
   URL**.
2. IAM -> **Identity providers** -> **Add provider** -> **OpenID Connect**.
   - Provider URL: paste the cluster's OIDC URL -> **Get thumbprint**.
   - Audience: `sts.amazonaws.com`.
   - **Add provider**.

Now IRSA roles can trust this cluster's service accounts (used in guide 06).

---

## Verify

- EKS console: cluster `ridenow` **Active**; three Fargate profiles
  (`ridenow-app`, `ridenow-system`, `ridenow-observability`) **Active**.
- `kubectl get pods -n kube-system` shows CoreDNS **Running** on Fargate.
- IAM -> Identity providers shows the cluster's OIDC provider.

Next: `06-eks-deploy.md`.
