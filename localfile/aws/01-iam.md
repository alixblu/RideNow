# 01 - IAM: who you are, and the roles EKS needs

Goal: sign in as a non-root user with enough permissions to build RideNow, and
create the two IAM **roles** EKS requires (a cluster role and a node role). EKS
will not start without these roles.

Time: ~15 min. Cost: IAM is free.

---

## 1. Stop using the root user

The email+password you created the account with is the **root user**. Do not
build day-to-day with it.

1. Console -> search **IAM** -> open it.
2. Left nav -> **Users** -> **Create user**.
3. User name: `ridenow-admin`. Check **Provide user access to the AWS Management
   Console**. Set a password.
4. **Next** -> **Attach policies directly** -> for this learning project, attach
   **AdministratorAccess** (simplest). In a real org you would scope this down.
5. **Next** -> **Create user**.
6. Open the new user -> **Security credentials** -> note the **console sign-in
   URL**. Sign out of root, sign in as `ridenow-admin`.

> Why: root can do irreversible account-level things (close the account, change
> billing). Everyday work should use a scoped user so a mistake has a smaller
> blast radius.

---

## 2. Create the EKS **cluster role**

This is the role the EKS control plane assumes to manage AWS resources on your
behalf.

1. IAM -> **Roles** -> **Create role**.
2. Trusted entity type: **AWS service**.
3. Use case: find and pick **EKS** -> **EKS - Cluster**. **Next**.
4. The policy **AmazonEKSClusterPolicy** is attached automatically. **Next**.
5. Role name: `ridenow-eks-cluster-role`. **Create role**.

---

## 3. Create the EKS **node role**

This is the role the EC2 worker nodes (where your pods run) assume. It needs to
join the cluster, pull images from ECR, and run the networking plugin.

1. IAM -> **Roles** -> **Create role**.
2. Trusted entity: **AWS service** -> use case **EC2**. **Next**.
3. Attach these three managed policies (search each, tick it):
   - **AmazonEKSWorkerNodePolicy**
   - **AmazonEC2ContainerRegistryReadOnly**  (lets nodes pull from ECR - guide 03)
   - **AmazonEKS_CNI_Policy**  (the VPC networking plugin)
4. **Next**. Role name: `ridenow-eks-node-role`. **Create role**.

---

## 4. (Note) IRSA roles for later ops

The async/Redis "later ops" (guides 07-08) and the ALB Ingress (guide 06) use
**IRSA** (IAM Roles for Service Accounts) so specific pods get specific AWS
permissions without long-lived keys. You create those *after* the cluster exists
(the trust policy references the cluster's OIDC provider), so they live in the
guides that need them - not here.

---

## Verify

- You are signed in as `ridenow-admin`, not root.
- IAM -> Roles shows `ridenow-eks-cluster-role` and `ridenow-eks-node-role`.

## Clean up

IAM users/roles cost nothing; leave them. If you abandon the project, delete the
roles and the user to keep the account tidy.

Next: `02-vpc.md`.
