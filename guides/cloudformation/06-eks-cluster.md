# 06 - EKS cluster (control plane and Fargate profiles)

Creates a KMS key, the EKS cluster `ridenow-prod` and three Fargate profiles of `iac/stacks/06-eks-cluster.yaml` (`Environment=prod`, `KubernetesVersion=1.31`, from `iac/params/prod.json`) in region `ap-southeast-1`.

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `ClusterKmsKey` | KMS key | alias `ridenow-prod-eks-secrets`, description `ridenow-prod EKS secrets encryption key` |
| `Cluster` | EKS cluster | `ridenow-prod` (Kubernetes `1.31`) |
| `SystemFargateProfile` | EKS Fargate profile | `ridenow-prod-system` |
| `AppFargateProfile` | EKS Fargate profile | `ridenow-prod-app` |
| `ObservabilityFargateProfile` | EKS Fargate profile | `ridenow-prod-observability` |

## Depends on

Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws) first. You select each item below by name in the console.

| Template import | Resource it comes from | Fixed_Name to select | Discovery_Block variable | Used for |
|---|---|---|---|---|
| `ridenow-prod-iam-ClusterRoleArn` | IAM role from `01-iam.md` | `ridenow-prod-eks-cluster-role` | `CLUSTER_ROLE_ARN` | Cluster service role |
| `ridenow-prod-iam-FargatePodExecutionRoleArn` | IAM role from `01-iam.md` | `ridenow-prod-eks-fargate-pod-execution-role` | `FARGATE_POD_ROLE_ARN` | Pod execution role of the three profiles |
| `ridenow-prod-network-PrivateSubnetIds` | subnets from `02-network.md` | `ridenow-prod-private-1`, `ridenow-prod-private-2` | `PRIVATE_SUBNET_IDS` | Cluster subnets and Fargate profile subnets |
| `ridenow-prod-network-NodeSecurityGroupId` | security group from `02-network.md` | `ridenow-prod-cluster-sg` | `NODE_SG_ID` | Additional cluster security group |

## Create the resources

Do the steps in order. Note: the console needs an alias for the key (the Template has none), and EKS allows only one Fargate profile creating at a time, so wait for **Active** between profiles.

### 1. KMS key (`ClusterKmsKey`)

**Create the key**

1. Set the console region to **Asia Pacific (Singapore) ap-southeast-1**.
2. Go to **KMS -> Customer managed keys -> Create key**.
3. Set **Key type** to `Symmetric`.
4. Set **Key usage** to `Encrypt and decrypt`.
5. Expand **Advanced options**. Set **Key material origin** to `KMS`.
6. Set **Regionality** to `Single-Region key`.
7. Select **Next**.

**Alias and description**

1. Set **Alias** to `ridenow-prod-eks-secrets`.
2. Set **Description** to `ridenow-prod EKS secrets encryption key`.
3. Select **Next**.

**Permissions**

1. On **Key administrators**, tick nothing. Select **Next**.
2. On **Key users**, tick nothing. Select **Next**.
3. On **Key policy**, delete the existing JSON.
4. Paste the JSON below. Replace `<ACCOUNT_ID>` with your account id.
5. Select **Next**.
6. Select **Review**, then **Finish**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT_ID>:root" },
      "Action": "kms:*",
      "Resource": "*"
    }
  ]
}
```

**Turn on rotation**

1. Open the key. Go to the **Key rotation** tab and select **Edit**.
2. Tick **Automatically rotate this KMS key every year**.
3. Select **Save**.

### 2. EKS cluster (`Cluster`)

**Configure cluster**

1. Go to **EKS -> Clusters -> Create cluster**.
2. Set **Configuration options** to `Custom configuration`.
3. Turn **Use EKS Auto Mode** off.
4. Set **Name** to `ridenow-prod`.
5. Set **Cluster IAM role** to `ridenow-prod-eks-cluster-role`.
6. Set **Kubernetes version** to `1.31`.
7. Set **Upgrade policy** to `Standard`.
8. Leave **Bootstrap cluster administrator access** on `Allow cluster administrator access`.
9. Leave **Cluster authentication mode** on `EKS API and ConfigMap`.
10. Tick **Turn on envelope encryption of Kubernetes secrets using KMS**.
11. Set **KMS key** to the alias `ridenow-prod-eks-secrets`.
12. Select **Next**.

**Specify networking**

1. Set **VPC** to `ridenow-prod-vpc`.
2. In **Subnets**, untick every subnet except `ridenow-prod-private-1` and `ridenow-prod-private-2`.
3. Set **Security groups** to `ridenow-prod-cluster-sg`.
4. Set **Cluster IP address family** to `IPv4`.
5. Set **Cluster endpoint access** to `Public and private`.
6. Expand **Advanced settings**. Leave **Public access source allowlist** on `0.0.0.0/0`.
7. Select **Next**.

**Observability and add-ons**

1. On **Configure observability**, leave every control plane log type off. Select **Next**.
2. On **Select add-ons**, leave `kube-proxy`, `CoreDNS` and `Amazon VPC CNI` ticked. Select **Next**.
3. On **Configure selected add-ons settings**, leave the defaults. Select **Next**.
4. Select **Create**.
5. Wait 10 to 15 minutes until **Status** is `Active`.

### 3. Fargate profile `ridenow-prod-system` (`SystemFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-system`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `kube-system`. Leave **Match labels** empty.
7. Select **Add selector**. Set **Namespace** to `external-secrets`. Leave **Match labels** empty.
8. Select **Next**.
9. Select **Create**.
10. Wait 1 to 2 minutes until **Status** is `Active`.

### 4. Fargate profile `ridenow-prod-app` (`AppFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-app`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `ridenow`. Leave **Match labels** empty.
7. Select **Next**.
8. Select **Create**.
9. Wait until **Status** is `Active`.

### 5. Fargate profile `ridenow-prod-observability` (`ObservabilityFargateProfile`)

1. Go to **EKS -> Clusters -> `ridenow-prod` -> Compute** tab **-> Fargate profiles -> Add Fargate profile**.
2. Set **Name** to `ridenow-prod-observability`.
3. Set **Pod execution role** to `ridenow-prod-eks-fargate-pod-execution-role`.
4. In **Subnets**, keep only `ridenow-prod-private-1` and `ridenow-prod-private-2`.
5. Select **Next**.
6. Under **Pod selectors**, set **Namespace** to `aws-observability`. Leave **Match labels** empty.
7. Select **Next**.
8. Select **Create**.
9. Wait until **Status** is `Active`.
## Values to record

Read these in EKS -> Clusters -> `ridenow-prod`. The Discovery_Block fills the variables on its next run.

| Output (Template) | Discovery_Block variable | How to see it in the console | Used by |
|---|---|---|---|
| `ClusterName` | `CLUSTER_NAME` (always `ridenow-prod`) | EKS > Clusters > name | Every later guide and the Runbook |
| `ClusterEndpoint` | `EKS_ENDPOINT` | Overview > Details > **API server endpoint** | Runbook (connection checks) |
| `OidcIssuerUrl` | `OIDC_ISSUER_URL` | Overview > Details > **OpenID Connect provider URL** (`https://oidc.eks.ap-southeast-1.amazonaws.com/id/<OIDC id>`) | `07-eks-addons.md` (OIDC provider URL and the `OidcProviderId` value that is empty in `prod.json`) |
| `ClusterSecurityGroupId` | `EKS_CLUSTER_SG_ID` | Networking tab > **Cluster security group** | `07-eks-addons.md` (source of the database 5432 and Redis 6379 rules) |

## Post-Deploy

Write the cluster into your kubeconfig with the IAM identity that created it, then follow [Phase 3 of the Runbook](00-deploy-runbook.md#phase-3---make-the-cluster-usable) to patch CoreDNS for Fargate.

```bash
aws eks update-kubeconfig --name ridenow-prod
kubectl get svc kubernetes
```

Expected: `Updated context ...cluster/ridenow-prod`, then one `kubernetes   ClusterIP ... 443/TCP` row.

## Verify

Run the [Discovery_Block](00-deploy-runbook.md#discovery_block---load-every-non-fixed-value-from-aws), then:

```bash
for V in EKS_ENDPOINT OIDC_ISSUER_URL OIDC_ID EKS_CLUSTER_SG_ID; do echo "$V=${!V:-MISSING}"; done
aws eks describe-cluster --name ridenow-prod \
  --query 'cluster.[status,version,resourcesVpcConfig.endpointPublicAccess,resourcesVpcConfig.endpointPrivateAccess,encryptionConfig[0].resources[0]]' --output text
aws eks list-fargate-profiles --cluster-name ridenow-prod --output text
```

Expected: four variables with values (none `MISSING`), `ACTIVE  1.31  True  True  secrets`, and the three profiles `ridenow-prod-system`, `ridenow-prod-app`, `ridenow-prod-observability`. A missing item means that step was skipped or misspelled.

Next: `07-eks-addons.md`.
