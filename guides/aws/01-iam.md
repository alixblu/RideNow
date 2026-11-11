# 01 - IAM: who you are, and the roles EKS needs

Goal: sign in as a non-root user with enough permissions to build RideNow, and
create the two IAM **roles** EKS on Fargate requires (a cluster role and a
Fargate pod execution role). EKS will not start pods without these.

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

## 3. Create the EKS **Fargate pod execution role**

On Fargate there are no EC2 worker nodes, so there's no node role. Instead, each
Fargate profile references a **pod execution role** that Fargate uses to pull the
pod's image from ECR and ship its logs to CloudWatch.

1. IAM -> **Roles** -> **Create role**.
2. Trusted entity: **Custom trust policy**, and paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Service": "eks-fargate-pods.amazonaws.com" },
       "Action": "sts:AssumeRole"
     }]
   }
   ```
   (The console's "EKS - Fargate pod" use case sets the same trust; the custom
   policy just makes it explicit.)
3. **Next**. Attach the managed policy **AmazonEKSFargatePodExecutionRolePolicy**
   (covers ECR pull + the Fargate log router).
4. **Next**. Role name: `ridenow-eks-fargate-pod-execution-role`. **Create role**.

You'll select this role when you create the Fargate profiles in guide 05.

---

## 4. (Note) IRSA roles created later

The Redis and async messaging features (guides 07-08) and the ALB Ingress
(guide 06) use **IRSA** (IAM Roles for Service Accounts) so specific pods get
specific AWS permissions without long-lived keys. You create those *after* the
cluster exists (the trust policy references the cluster's OIDC provider), so they
live in the guides that need them - not here.

---

## Verify

- You are signed in as `ridenow-admin`, not root.
- IAM -> Roles shows `ridenow-eks-cluster-role` and
  `ridenow-eks-fargate-pod-execution-role`.

## Clean up

IAM users/roles cost nothing; leave them. If you abandon the project, delete the
roles and the user to keep the account tidy.

Next: `02-vpc.md`.
