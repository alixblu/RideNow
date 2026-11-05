# 06 - EKS cluster (manual console)

Goal: create the EKS cluster + node group by hand in the console, reusing the
IAM roles and network the CloudFormation foundation already made.

This is the manual console walkthrough from `../aws/05-eks-cluster.md` - follow
it click-by-click. The only difference in the hybrid route is **where the inputs
come from**: use the CloudFormation **exports** instead of console-created
resources.

---

## Use these CloudFormation values instead of creating new ones

When `../aws/05-eks-cluster.md` asks you to pick a role / VPC / subnets:

| The manual guide asks for... | Use the CFN export | Get it with |
|------------------------------|--------------------|-------------|
| Cluster service role | the EKS **cluster role** from stack 01-iam | see `iac/stacks/01-iam.yaml` outputs / IAM console (`ridenow-dev-*` cluster role) |
| Node group IAM role | the EKS **node role** from stack 01-iam | same |
| VPC | `ridenow-dev-network-VpcId` | `aws cloudformation list-exports --query "Exports[?Name=='ridenow-dev-network-VpcId'].Value" --output text` |
| Cluster subnets | the private + public subnet ids | `ridenow-dev-network-PrivateSubnetIds`, `ridenow-dev-network-PublicSubnetIds` |
| Node group subnets | the **private** subnet ids only | `ridenow-dev-network-PrivateSubnetIds` |

Because stack 01-iam already created the cluster and node roles with the right
policies, you do **not** repeat `../aws/01-iam.md` - skip straight to creating
the cluster.

---

## Steps (summary; full detail in ../aws/05-eks-cluster.md)

1. **Create cluster** (`../aws/05` Part A): name `ridenow`, custom config, pick
   the CloudFormation **cluster role**, select the CloudFormation VPC + subnets,
   endpoint access Public and private, keep the default add-ons.
2. **Add node group** (Part B): name `ridenow-nodes`, pick the CloudFormation
   **node role**, `t3.medium`, min 2 / desired 2 / max 3, **private** subnets
   only.
3. **Connect kubectl** (Part C):
   ```bash
   aws eks update-kubeconfig --name ridenow --region ap-southeast-1
   kubectl get nodes          # two Ready nodes = success
   ```
4. **Enable the OIDC provider** (Part D) - needed by the ALB controller and the
   later-op IRSA roles.

> If you accidentally let CloudFormation create the EKS cluster (stack
> `06-eks-cluster` via the full `deploy.sh --apply`), either use that cluster and
> skip this guide, or delete that stack first so you can build EKS by hand here.
> Don't run both - you'd have two clusters billing you.

## Verify

- `kubectl get nodes` lists two **Ready** nodes.
- IAM -> Identity providers shows the cluster's OIDC provider.

Next: `07-eks-deploy.md`.
