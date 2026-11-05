# 02 - VPC: the private network EKS runs in

Goal: a VPC with public and private subnets across two Availability Zones, an
internet gateway, a NAT gateway, and the security groups RDS will use. EKS nodes
and databases live in **private** subnets; the load balancer lives in **public**
subnets.

Time: ~15 min. Cost: the **NAT gateway bills hourly + per GB** - the main cost
here. Delete it when you stop (see Clean up).

---

## Why this shape

- **Public subnets**: anything that must be reachable from the internet - here,
  the ALB that fronts the services. They route to the **internet gateway**.
- **Private subnets**: your EKS nodes (pods) and RDS. No direct inbound from the
  internet. For outbound (pulling images, reaching AWS APIs) they route through a
  **NAT gateway** that sits in a public subnet.
- **Two AZs**: so a single AZ failure doesn't take the whole system down, and so
  EKS/RDS can offer multi-AZ options.

This mirrors `../../iac/stacks/02-network.yaml`.

---

## 1. Create the VPC (the easy way)

The console's VPC wizard builds subnets, route tables, IGW, and NAT in one shot.

1. Console -> **VPC** -> **Create VPC**.
2. Choose **VPC and more** (this is the wizard - do NOT choose "VPC only").
3. Name tag auto-generation: `ridenow`.
4. IPv4 CIDR: `10.0.0.0/16`.
5. **Number of Availability Zones (AZs): 2**.
6. **Number of public subnets: 2**.
7. **Number of private subnets: 2**.
8. **NAT gateways: In 1 AZ** (cheapest that still works; "1 per AZ" is more
   resilient but doubles cost).
9. **VPC endpoints: None** (optional cost optimization; skip for now).
10. **DNS options**: leave both **Enable DNS hostnames** and **Enable DNS
    resolution** checked.
11. **Create VPC**. Wait for all resources to go green.

You now have: 1 VPC, 2 public + 2 private subnets, 1 IGW, 1 NAT gateway, route
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
   - Source: **Custom** -> enter the VPC CIDR `10.0.0.0/16`.
     (Later, tighten this to the EKS node security group once the cluster exists.)
4. Leave outbound as the default (all). **Create security group**.

---

## Verify

- VPC -> **Resource map** shows the VPC with 2 public + 2 private subnets, an
  IGW, and a NAT gateway.
- Subnets carry the `kubernetes.io/role/*` tags.
- `ridenow-db-sg` exists and allows 5432 from `10.0.0.0/16` only.

## Clean up

The **NAT gateway** is the costly part. If you stop for a while: VPC -> NAT
gateways -> delete it (recreate later via the wizard, or add one back manually).
Deleting the whole VPC is only possible after everything inside it (EKS, RDS) is
gone.

Next: `03-ecr.md`.
