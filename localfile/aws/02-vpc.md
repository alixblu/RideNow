# 02 - VPC: the private network EKS runs in

Goal: a production VPC with public and private subnets across **three
Availability Zones**, an internet gateway, **one NAT gateway per AZ**, and the
security groups RDS will use. Fargate pods and databases live in **private**
subnets; the load balancer lives in **public** subnets.

Time: ~15 min. Cost: the **NAT gateways bill hourly + per GB** — three of them in
this layout, the main steady-state network cost.

---

## Why this shape

- **Public subnets**: anything that must be reachable from the internet - here,
  the ALB that fronts the services. They route to the **internet gateway**.
- **Private subnets**: your Fargate pods and RDS. No direct inbound from the
  internet. For outbound (pulling images, reaching AWS APIs) they route through a
  **NAT gateway** in the same AZ.
- **Three AZs with a NAT per AZ**: a single AZ (or its NAT) failing never takes
  the system down, and Multi-AZ RDS has three zones to spread across. Keeping
  each AZ's egress on its own NAT avoids a cross-AZ single point of failure.

This mirrors `../../iac/stacks/02-network.yaml`.

---

## 1. Create the VPC (the easy way)

The console's VPC wizard builds subnets, route tables, IGW, and NAT in one shot.

1. Console -> **VPC** -> **Create VPC**.
2. Choose **VPC and more** (this is the wizard - do NOT choose "VPC only").
3. Name tag auto-generation: `ridenow`.
4. IPv4 CIDR: `10.30.0.0/16`.
5. **Number of Availability Zones (AZs): 3**.
6. **Number of public subnets: 3**.
7. **Number of private subnets: 3**.
8. **NAT gateways: 1 per AZ** (resilient — each AZ egresses independently).
9. **VPC endpoints: None** (optional cost optimization; skip for now).
10. **DNS options**: leave both **Enable DNS hostnames** and **Enable DNS
    resolution** checked.
11. **Create VPC**. Wait for all resources to go green.

You now have: 1 VPC, 3 public + 3 private subnets, 1 IGW, 3 NAT gateways, route
tables wired correctly.

---

## 2. Tag subnets so EKS + the ALB can discover them

The AWS Load Balancer Controller (guide 06) finds subnets by tag. Add these:

1. VPC -> **Subnets**. Select each **public** subnet -> **Tags** tab -> add:
   - Key `kubernetes.io/role/elb`, Value `1`
2. Select each **private** subnet -> add:
   - Key `kubernetes.io/role/internal-elb`, Value `1`

(The cluster also tags subnets itself once created, but setting the ELB role tags
now avoids a common "ingress won't provision" snag later.)

---

## 3. Create the database security group

This is the firewall RDS will use (guide 04). It should allow PostgreSQL (5432)
**only** from inside the VPC / from the EKS nodes - never the internet.

1. VPC -> **Security groups** -> **Create security group**.
2. Name: `ridenow-db-sg`. Description: `RideNow RDS - 5432 from inside the VPC`.
   VPC: the `ridenow` VPC.
3. **Inbound rules** -> **Add rule**:
   - Type **PostgreSQL** (port 5432 auto-fills).
   - Source: **Custom** -> enter the VPC CIDR `10.30.0.0/16`.
     (Once the cluster exists, tighten this to the EKS **cluster security group**
     — Fargate pods attach to it — and then to the per-service SGs from guide 06
     step 2.5.)
4. Leave outbound as the default (all). **Create security group**.

---

## Verify

- VPC -> **Resource map** shows the VPC with 3 public + 3 private subnets, an
  IGW, and 3 NAT gateways.
- Subnets carry the `kubernetes.io/role/*` tags.
- `ridenow-db-sg` exists and allows 5432 from `10.30.0.0/16` only.

## Clean up

The **NAT gateways** are the costly part (three of them here). Deleting the whole
VPC is only possible after everything inside it (EKS, RDS) is gone — tear down in
reverse guide order (08 -> 01).

Next: `03-ecr.md`.
