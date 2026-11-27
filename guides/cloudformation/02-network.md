# 02 - VPC, NAT and security groups

Creates the prod VPC (`10.30.0.0/16`) with 2 public and 2 private subnets, an internet gateway, 2 NAT gateways and 2 security groups. Region: `ap-southeast-1`. Source: `iac/stacks/02-network.yaml`, `iac/params/prod.json`.
## What it creates

| Template logical ID | AWS resource type | Name (Resolved_Value) |
|---|---|---|
| `Vpc` | `AWS::EC2::VPC` | `ridenow-prod-vpc` |
| `InternetGateway` | `AWS::EC2::InternetGateway` | `ridenow-prod-igw` |
| `VpcGatewayAttachment` | `AWS::EC2::VPCGatewayAttachment` | `ridenow-prod-igw` attached to `ridenow-prod-vpc` |
| `PublicSubnet1` | `AWS::EC2::Subnet` | `ridenow-prod-public-1` |
| `PublicSubnet2` | `AWS::EC2::Subnet` | `ridenow-prod-public-2` |
| `PrivateSubnet1` | `AWS::EC2::Subnet` | `ridenow-prod-private-1` |
| `PrivateSubnet2` | `AWS::EC2::Subnet` | `ridenow-prod-private-2` |
| `PublicRouteTable` | `AWS::EC2::RouteTable` | `ridenow-prod-public-rt` |
| `PublicDefaultRoute` | `AWS::EC2::Route` | `0.0.0.0/0` to `ridenow-prod-igw` |
| `PublicSubnet1RouteAssoc` | `AWS::EC2::SubnetRouteTableAssociation` | `ridenow-prod-public-1` with `ridenow-prod-public-rt` |
| `PublicSubnet2RouteAssoc` | `AWS::EC2::SubnetRouteTableAssociation` | `ridenow-prod-public-2` with `ridenow-prod-public-rt` |
| `NatEip1` | `AWS::EC2::EIP` | `ridenow-prod-nat-eip-1` |
| `NatGateway1` | `AWS::EC2::NatGateway` | `ridenow-prod-nat-1` |
| `NatEip2` | `AWS::EC2::EIP` | `ridenow-prod-nat-eip-2` |
| `NatGateway2` | `AWS::EC2::NatGateway` | `ridenow-prod-nat-2` |
| `PrivateRouteTable1` | `AWS::EC2::RouteTable` | `ridenow-prod-private-rt-1` |
| `PrivateDefaultRoute1` | `AWS::EC2::Route` | `0.0.0.0/0` to `ridenow-prod-nat-1` |
| `PrivateSubnet1RouteAssoc` | `AWS::EC2::SubnetRouteTableAssociation` | `ridenow-prod-private-1` with `ridenow-prod-private-rt-1` |
| `PrivateRouteTable2` | `AWS::EC2::RouteTable` | `ridenow-prod-private-rt-2` |
| `PrivateDefaultRoute2` | `AWS::EC2::Route` | `0.0.0.0/0` to `ridenow-prod-nat-2` |
| `PrivateSubnet2RouteAssoc` | `AWS::EC2::SubnetRouteTableAssociation` | `ridenow-prod-private-2` with `ridenow-prod-private-rt-2` |
| `ClusterSecurityGroup` | `AWS::EC2::SecurityGroup` | `ridenow-prod-cluster-sg` |
| `ClusterSelfIngress` | `AWS::EC2::SecurityGroupIngress` | rule on `ridenow-prod-cluster-sg` |
| `DbSecurityGroup` | `AWS::EC2::SecurityGroup` | `ridenow-prod-db-sg` |
| `DbIngressFromCluster` | `AWS::EC2::SecurityGroupIngress` | rule on `ridenow-prod-db-sg` |

## Depends on

No other guide has to be finished first. The template has no `Fn::ImportValue` entries. Check these two values before you start:

| Value | Where to find it in the console |
|---|---|
| Region (`ap-southeast-1`) | Region selector at the top right of the console. Choose **Asia Pacific (Singapore)**. |
| Account id (12 digits, only to confirm you are in the right account) | Account name at the top right of the console, shown under **Account ID**. |

## Create the resources

Console region: Asia Pacific (Singapore) `ap-southeast-1`. Use the first two AZs (`ap-southeast-1a`, `ap-southeast-1b`).

### 1. VPC (`Vpc`)

1. Go to **VPC -> Your VPCs -> Create VPC**.
2. Set **Resources to create** to `VPC only`.
3. Set **Name tag - optional** to `ridenow-prod-vpc`. This is the VPC **Name**.
4. Set **IPv4 CIDR block** to `IPv4 CIDR manual input`.
5. Set **IPv4 CIDR** to `10.30.0.0/16`.
6. Set **IPv6 CIDR block** to `No IPv6 CIDR block`.
7. Set **Tenancy** to `Default`.
8. Choose **Create VPC**.

Enable DNS:

1. Select `ridenow-prod-vpc`.
2. Go to **Actions -> Edit VPC settings**.
3. Under **DNS settings**, tick **Enable DNS resolution**.
4. Tick **Enable DNS hostnames**.
5. Choose **Save**.

### 2. Internet gateway (`InternetGateway`, `VpcGatewayAttachment`)

1. Go to **VPC -> Internet gateways -> Create internet gateway**.
2. Set **Name tag** to `ridenow-prod-igw`. This is the gateway **Name**.
3. Choose **Create internet gateway**.
4. Go to **Actions -> Attach to VPC**.
5. Set **Available VPCs** to `ridenow-prod-vpc`.
6. Choose **Attach internet gateway**.

### 3. Subnets (`PublicSubnet1`, `PublicSubnet2`, `PrivateSubnet1`, `PrivateSubnet2`)

Start the form:

1. Go to **VPC -> Subnets -> Create subnet**.
2. Set **VPC ID** to `ridenow-prod-vpc`.

Subnet 1:

1. Set **Subnet name** to `ridenow-prod-public-1`.
2. Set **Availability Zone** to `ap-southeast-1a`.
3. Set **IPv4 subnet CIDR block** to `10.30.0.0/20`.
4. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `kubernetes.io/role/elb` and **Value** to `1`. The `Name` tag is already filled from **Subnet name**.

Subnet 2 (choose **Add new subnet** first):

1. Set **Subnet name** to `ridenow-prod-public-2`.
2. Set **Availability Zone** to `ap-southeast-1b`.
3. Set **IPv4 subnet CIDR block** to `10.30.16.0/20`.
4. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `kubernetes.io/role/elb` and **Value** to `1`.

Subnet 3 (choose **Add new subnet** first):

1. Set **Subnet name** to `ridenow-prod-private-1`.
2. Set **Availability Zone** to `ap-southeast-1a`.
3. Set **IPv4 subnet CIDR block** to `10.30.48.0/20`.
4. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `kubernetes.io/role/internal-elb` and **Value** to `1`.

Subnet 4 (choose **Add new subnet** first):

1. Set **Subnet name** to `ridenow-prod-private-2`.
2. Set **Availability Zone** to `ap-southeast-1b`.
3. Set **IPv4 subnet CIDR block** to `10.30.64.0/20`.
4. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `kubernetes.io/role/internal-elb` and **Value** to `1`.

Finish:

1. Choose **Create subnet**.

Check the tags: open each subnet's **Tags** tab. The two public subnets must show `kubernetes.io/role/elb` = `1`, and the two private subnets must show `kubernetes.io/role/internal-elb` = `1`. The AWS Load Balancer Controller finds the subnets for the ALB by these tags. If a tag is missing, choose **Manage tags** and add it.

Enable public IPs on `ridenow-prod-public-1`:

1. Go to **VPC -> Subnets** and select `ridenow-prod-public-1`.
2. Go to **Actions -> Edit subnet settings**.
3. Tick **Enable auto-assign public IPv4 address**.
4. Choose **Save**.

Enable public IPs on `ridenow-prod-public-2`:

1. Go to **VPC -> Subnets** and select `ridenow-prod-public-2`.
2. Go to **Actions -> Edit subnet settings**.
3. Tick **Enable auto-assign public IPv4 address**.
4. Choose **Save**.

Leave auto-assign off on both private subnets.

### 4. Public route table (`PublicRouteTable`, `PublicDefaultRoute`, `PublicSubnet1RouteAssoc`, `PublicSubnet2RouteAssoc`)

Create the table:

1. Go to **VPC -> Route tables -> Create route table**.
2. Set **Name** to `ridenow-prod-public-rt`.
3. Set **VPC** to `ridenow-prod-vpc`.
4. Choose **Create route table**.

Add the default route:

1. Open the **Routes** tab and choose **Edit routes -> Add route**.
2. Set **Destination** to `0.0.0.0/0`.
3. Set **Target** to **Internet Gateway** and pick `ridenow-prod-igw`.
4. Choose **Save changes**.

Associate the subnets:

1. Open the **Subnet associations** tab and choose **Edit subnet associations**.
2. Tick `ridenow-prod-public-1`.
3. Tick `ridenow-prod-public-2`.
4. Choose **Save associations**.

### 5. Elastic IPs and NAT gateways (`NatEip1`, `NatGateway1`, `NatEip2`, `NatGateway2`)

Allocate the first Elastic IP:

1. Go to **VPC -> Elastic IPs -> Allocate Elastic IP address**.
2. Set **Public IPv4 address pool** to `Amazon's pool of IPv4 addresses`.
3. Set **Network border group** to `ap-southeast-1`.
4. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `Name` and **Value** to `ridenow-prod-nat-eip-1`.
5. Choose **Allocate**.

Allocate the second Elastic IP:

1. Choose **Allocate Elastic IP address** again.
2. Use the same settings as the first address, but set the `Name` tag **Value** to `ridenow-prod-nat-eip-2`.
3. Choose **Allocate**.

Create NAT gateway 1:

1. Go to **VPC -> NAT gateways -> Create NAT gateway**.
2. Set **Name** to `ridenow-prod-nat-1`.
3. Set **Subnet** to `ridenow-prod-public-1`.
4. Set **Connectivity type** to `Public`.
5. Set **Elastic IP allocation ID** to the first Elastic IP you allocated.
6. Choose **Create NAT gateway**.

Create NAT gateway 2:

1. Choose **Create NAT gateway** again.
2. Set **Name** to `ridenow-prod-nat-2`.
3. Set **Subnet** to `ridenow-prod-public-2`.
4. Set **Connectivity type** to `Public`.
5. Set **Elastic IP allocation ID** to the second Elastic IP (the one not yet associated).
6. Choose **Create NAT gateway**.

Wait:

1. Wait until both gateways show **State** `Available` (3 to 5 minutes).

### 6. Private route tables (`PrivateRouteTable1`, `PrivateDefaultRoute1`, `PrivateSubnet1RouteAssoc`, `PrivateRouteTable2`, `PrivateDefaultRoute2`, `PrivateSubnet2RouteAssoc`)

Route table 1:

1. Go to **VPC -> Route tables -> Create route table**.
2. Set **Name** to `ridenow-prod-private-rt-1`.
3. Set **VPC** to `ridenow-prod-vpc`.
4. Choose **Create route table**.
5. Open the **Routes** tab and choose **Edit routes -> Add route**.
6. Set **Destination** to `0.0.0.0/0`.
7. Set **Target** to **NAT Gateway** and pick `ridenow-prod-nat-1`.
8. Choose **Save changes**.
9. Open the **Subnet associations** tab and choose **Edit subnet associations**.
10. Tick `ridenow-prod-private-1`.
11. Choose **Save associations**.

Route table 2:

1. Go to **VPC -> Route tables -> Create route table**.
2. Set **Name** to `ridenow-prod-private-rt-2`.
3. Set **VPC** to `ridenow-prod-vpc`.
4. Choose **Create route table**.
5. Open the **Routes** tab and choose **Edit routes -> Add route**.
6. Set **Destination** to `0.0.0.0/0`.
7. Set **Target** to **NAT Gateway** and pick `ridenow-prod-nat-2`.
8. Choose **Save changes**.
9. Open the **Subnet associations** tab and choose **Edit subnet associations**.
10. Tick `ridenow-prod-private-2`.
11. Choose **Save associations**.

### 7. Cluster security group (`ClusterSecurityGroup`, `ClusterSelfIngress`)

Create the group:

1. Go to **VPC -> Security groups -> Create security group**.
2. Set **Security group name** to `ridenow-prod-cluster-sg`.
3. Set **Description** to `ridenow-prod EKS / application pods`.
4. Set **VPC** to `ridenow-prod-vpc`.
5. Leave **Inbound rules** empty.
6. Keep the default **Outbound rules** row: **Type** `All traffic`, **Protocol** `All`, **Port range** `All`, **Destination** `Anywhere-IPv4` `0.0.0.0/0`.
7. Set that outbound row **Description** to `Allow all egress (NAT to internet, RDS, etc.)`.
8. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `Name` and **Value** to `ridenow-prod-cluster-sg`. This tag makes the group easy to find in the console list.
9. Choose **Create security group**.

Add the self-referencing rule:

1. Open `ridenow-prod-cluster-sg`.
2. Open the **Inbound rules** tab and choose **Edit inbound rules -> Add rule**.
3. Set **Type** to `All traffic`.
4. Set **Source** to **Custom** and pick `ridenow-prod-cluster-sg` (the group itself).
5. Set **Description** to `Allow all traffic between members of this SG`.
6. Choose **Save rules**.

### 8. Database security group (`DbSecurityGroup`, `DbIngressFromCluster`)

1. Go to **VPC -> Security groups -> Create security group**.
2. Set **Security group name** to `ridenow-prod-db-sg`.
3. Set **Description** to `ridenow-prod RDS PostgreSQL (private)`.
4. Set **VPC** to `ridenow-prod-vpc`.
5. Under **Inbound rules**, choose **Add rule**.
6. Set **Type** to `PostgreSQL` (Protocol `TCP`, Port range `5432`).
7. Set **Source** to **Custom** and pick `ridenow-prod-cluster-sg`.
8. Set the rule **Description** to `Postgres 5432 from the RideNow cluster SG only`.
9. Keep the default **Outbound rules** row: **Type** `All traffic`, **Protocol** `All`, **Port range** `All`, **Destination** `Anywhere-IPv4` `0.0.0.0/0`.
10. Set that outbound row **Description** to `Allow all egress`.
11. Under **Tags - optional**, choose **Add new tag**. Set **Key** to `Name` and **Value** to `ridenow-prod-db-sg`.
12. Choose **Create security group**.

Add no CIDR inbound rule.
## Values to record

The template exports six values. Without CloudFormation, you read each one from the console.

| Template output | Output_Equivalent | Used by |
|---|---|---|
| `VpcId` | VPC console, **Your VPCs**, `ridenow-prod-vpc`, **VPC ID** (`vpc-...`) | `05-messaging.md` (Redis security group), [06-eks-cluster.md](06-eks-cluster.md#3-aws-load-balancer-controller) (load balancer controller `vpcId`), the per-pod security groups |
| `VpcCidr` | `10.30.0.0/16` (the value you entered in step 1) | reference only |
| `PublicSubnetIds` | Subnets `ridenow-prod-public-1` and `ridenow-prod-public-2`, **Subnet ID** column | the ALB created by the Ingress (it uses the public subnets by tag) |
| `PrivateSubnetIds` | Subnets `ridenow-prod-private-1` and `ridenow-prod-private-2`, **Subnet ID** column | `04-data.md` (DB subnet group), `05-messaging.md` (Redis subnet group), `06-eks-cluster.md` (cluster and the three Fargate profiles) |
| `NodeSecurityGroupId` | Security group `ridenow-prod-cluster-sg`, **Security group ID** (`sg-...`) | `05-messaging.md` (Redis ingress source), `06-eks-cluster.md` (cluster security group) |
| `DbSecurityGroupId` | Security group `ridenow-prod-db-sg`, **Security group ID** (`sg-...`) | `04-data.md` (the six RDS instances), `07-eks-addons.md` (ingress rule from the EKS cluster security group), the per-pod security groups |

Keep these id values in a text file. You can always read them again from the console.

None of the `02-network` parameters in `prod.json` is empty, so nothing else needs to be looked up.

## Post-Deploy

No Post-Deploy step is needed for this guide.

## Verify

Run in a terminal with the AWS CLI signed in to the same account. The first lines look the ids up by name. Alternatively, replace the `$(...)` parts with the `vpc-...` and `sg-...` ids you recorded in "Values to record".

```bash
export AWS_DEFAULT_REGION=ap-southeast-1
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=ridenow-prod-vpc" --query 'Vpcs[0].VpcId' --output text)
DB_SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ridenow-prod-db-sg" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" --query 'Vpcs[0].[CidrBlock,State]' --output text
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'length(Subnets)'
aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" --query 'length(NatGateways)'
aws ec2 describe-security-groups --group-ids "$DB_SG_ID" --query 'SecurityGroups[0].IpPermissions[].[IpProtocol,FromPort,ToPort]' --output text
```

Expected: `10.30.0.0/16  available`, `4`, `2`, `tcp  5432  5432`. If a value is wrong, recheck the matching step in the VPC console.
