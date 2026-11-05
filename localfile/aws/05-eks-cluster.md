# 05 - EKS: create the cluster and connect to it (the main event)

Goal: an Amazon EKS cluster with a small managed node group, running in the
private subnets from guide 02, using the roles from guide 01. Then connect
`kubectl` so you can deploy in guide 06.

Time: ~25 min (the control plane + node group take ~10-15 min each to provision).
Cost: the **EKS control plane bills per hour** the moment it exists, plus the
EC2 nodes. This is the single most important thing to delete when you stop.

---

## Part A - Create the cluster (control plane)

1. Console -> **EKS** -> **Clusters** -> **Create cluster**.
2. **Configuration options**: **Custom configuration**. Turn **off** "Use EKS
   Auto Mode" for this guide (we create our own node group so the steps are
   explicit and match the manifests).
3. **Name**: `ridenow`.
4. **Kubernetes version**: accept the default (latest stable).
5. **Cluster service role**: pick **`ridenow-eks-cluster-role`** (from guide 01).
6. **Next**.
7. **Networking**:
   - VPC: the `ridenow` VPC.
   - Subnets: select the **two private** subnets (where nodes/pods run) and the
     **two public** subnets (so a public ALB can attach). If unsure, select all
     four.
   - Cluster endpoint access: **Public and private** (simplest - you reach the
     API from your laptop; nodes reach it privately). You can tighten to private
     later.
8. **Next** → review → **Create**. Wait until the cluster **Status** is
   **Active** (~10 min).

---

## Part A½ - Configure observability (screen between cluster and node group)

After the cluster is **Active**, the console presents a **Configure
observability** screen before you can add a node group. Use these settings:

### Metrics

- **Prometheus**: **Enable** "Send Prometheus metrics to Amazon Managed Service
  for Prometheus". This installs the AWS Distro for OpenTelemetry (ADOT)
  collector as a daemonset and scrapes all pod and node metrics; you query them
  in AMP or view them from Grafana later.
- **CloudWatch**: **Enable** "Send application and infrastructure telemetry to
  Amazon CloudWatch".
  - **Container Insights**: choose **OTel Container Insights** (recommended).
    Sends pod and node metrics to CloudWatch using OpenTelemetry collectors.
  - **Application Signals**: **Enable**. Instruments the Java/Spring Boot
    services automatically for APM — traces, latency, and error rate — with no
    code changes required.

### Container network observability

- **Network monitoring**: **Enable**.
  - **Name for your monitor**: `ridenow-dev` (valid characters: a-z, A-Z, 0-9,
    `_`, `-`, `.`; you cannot rename it after creation).
  - This creates a Network Flow Monitor that gives you a service map, per-flow
    table, and network performance metrics for traffic inside the cluster and out
    to the rest of `ap-southeast-1`.

### Control plane logs

Enable **all five**. They land in CloudWatch Logs under
`/aws/eks/ridenow/cluster`.

- ✓ **API server** — every API request (kubectl, controllers, pod creation)
- ✓ **Audit** — authentication and authorization decisions
- ✓ **Authenticator** — IAM-to-Kubernetes identity mapping
- ✓ **Controller manager** — reconciliation loops (deployments, replica sets)
- ✓ **Scheduler** — pod placement decisions

> **Cost note**: all five logs on a small lab cluster generate roughly 200–800 MB/day
> (~$0.10–0.40/day at $0.50/GB in ap-southeast-1). Network Flow Monitor bills
> separately per flow record. See `06a-observability.md` for how to read and
> use all of this.

Click **Next** to proceed to the node group.

---

## Part A¾ - Select add-ons (screen after Configure observability)

The console shows a full add-on catalogue. Enable exactly these — leave
everything else (SageMaker, FSx, SR-IOV, GuardDuty, Marketplace) off:

| Add-on | Default | Action |
|--------|---------|--------|
| **Amazon VPC CNI** | ✓ pre-selected | Keep — pod networking, required |
| **CoreDNS** | ✓ pre-selected | Keep — in-cluster DNS, required |
| **kube-proxy** | ✓ pre-selected | Keep — service networking, required |
| **Amazon CloudWatch Observability** | ✓ pre-selected | Keep — installs the CloudWatch agent; enables Container Insights (OTel) and Application Signals |
| **AWS Network Flow Monitor Agent** | ✓ pre-selected | Keep — required for the `ridenow-dev` monitor you enabled in the observability screen |
| **Amazon EKS Pod Identity Agent** | ✓ pre-selected | Keep — lets pods assume IAM roles via service accounts (ALB controller, External Secrets in guide 06) |
| **Metrics Server** | ✓ pre-selected | Keep — required for `kubectl top nodes/pods` and HPA |
| **AWS Distro for OpenTelemetry** | ✗ not default | **Add** — ADOT collector daemonset; required for the AMP Prometheus scraper |
| **AWS Secrets Store CSI Driver Provider** | ✗ not default | **Add** — mounts Secrets Manager secrets (RDS credentials) as files into pods (guide 07) |
| **Kube State Metrics** | ✗ not default | **Add** — exposes Kubernetes object metrics (pod restarts, replica counts) to Prometheus; needed for PromQL queries in `06a-observability.md` |

Click **Next** → configure add-on versions: accept the defaults for all of them
→ **Next** → **Create**. The cluster will move to **Active** in ~10 min.

---

## Part B - Add EC2 nodes

1. Open the `ridenow` cluster -> **Compute** tab -> **Add node group**.
2. **Name**: `ridenow-nodes`.
3. **Node IAM role**: pick **`ridenow-eks-node-role`** (from guide 01).
4. **Next**.
5. **Instance type**: `t3.medium` (fine for the whole backend in a lab).
6. **Disk size**: 20 GiB.
7. **Scaling**: Min 2, Desired 2, Max 3. (Two nodes comfortably hold all six
   services at the manifests' requested resources.)
8. **Next** -> **Subnets**: select the **two private** subnets only (nodes must
   not be publicly addressable; they reach out via the NAT gateway).
9. **Next** -> review -> **Create**. Wait until the node group is **Active** and
   nodes show **Ready** (~3-5 min).

---

## Part C - Connect kubectl from your laptop

1. Make sure the AWS CLI is configured as `ridenow-admin` (`aws sts
   get-caller-identity` returns your account).
2. Update your kubeconfig so `kubectl` talks to the cluster:

   ```bash
   aws eks update-kubeconfig --name ridenow --region ap-southeast-1
   ```

3. Confirm you can see the nodes:

   ```bash
   kubectl get nodes
   # NAME                             STATUS   ROLES    AGE   VERSION
   # ip-10-0-x-x.ap-southeast-1...    Ready    <none>   2m    v1.3x
   ```

Two `Ready` nodes = the cluster is live and you're connected. This is the EKS
milestone.

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

- EKS console: cluster `ridenow` **Active**, node group `ridenow-nodes` **Active**.
- `kubectl get nodes` lists two **Ready** nodes.
- IAM -> Identity providers shows the cluster's OIDC provider.

Next: `06-eks-deploy.md`.
