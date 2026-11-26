# 02 - VPC, NAT and security groups

Stack `ridenow-<env>-02-network` from `iac/stacks/02-network.yaml`. Depends on: none.

## What it creates

- One VPC (`10.30.0.0/16` by default) with DNS support and DNS hostnames.
- Two public and two private subnets, one pair in each of 2 Availability Zones.
- An internet gateway, and **one NAT gateway per AZ** (the main steady cost here).
- Route tables: public subnets route to the internet gateway; each private subnet routes to the NAT in its own AZ.
- Subnet tags the load balancer controller needs: `kubernetes.io/role/elb` (public) and `kubernetes.io/role/internal-elb` (private).
- A cluster security group (pods, open between its own members) and a database security group (PostgreSQL 5432 from the cluster security group only).
- Six exports: `VpcId`, `VpcCidr`, `PublicSubnetIds`, `PrivateSubnetIds`, `NodeSecurityGroupId` (the cluster security group under its older name) and `DbSecurityGroupId`. Stacks 04, 05 and 06 import them.

## Deploy

Dependencies: none. This stack can be deployed right after `00-prerequisites.md`.

### Configure

Show the parameter values this stack uses for the current environment.

```bash
params 02-network
```

Expected: `Environment=prod` and `VpcCidr=10.30.0.0/16`.

Each environment needs a CIDR that does not overlap the others, so dev, staging and prod can coexist. To use another CIDR for one run only, pass it to `cfn_deploy` in the next step:

```bash
cfn_deploy 02-network VpcCidr=10.40.0.0/16
```

### Run

Create or update the stack. The NAT gateways take 3-5 minutes.

```bash
cfn_deploy 02-network
```

Expected last line: `Successfully created/updated stack - ridenow-prod-02-network`.

Check the stack status.

```bash
stack_status 02-network
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a re-run).

### If it fails

List the newest failed events for this stack.

```bash
stack_failures 02-network
```

`VpcLimitExceeded` or `AddressLimitExceeded` (Elastic IPs) means the account is at its quota. Release unused resources or request a limit increase. `InvalidParameterValue` on `VpcCidr` means the CIDR is not a valid /16.

## Post-Deploy

No post-deploy configuration is needed for this stack.

## Verify

Read the VPC id from the stack export.

```bash
VPC_ID=$(exp network-VpcId); echo $VPC_ID
```

Expected: an id like `vpc-0abc...`.

VPC state, CIDR and DNS settings:

```bash
aws ec2 describe-vpcs --vpc-ids $VPC_ID --query 'Vpcs[0].[CidrBlock,State]' --output text
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsSupport   --query 'EnableDnsSupport.Value'   --output text
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsHostnames --query 'EnableDnsHostnames.Value' --output text
```

Expected: `10.30.0.0/16  available`, then `True`, then `True`.

Four subnets, two per AZ:

```bash
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID \
  --query 'Subnets[].[Tags[?Key==`Name`]|[0].Value,AvailabilityZone,CidrBlock]' \
  --output text | sort
```

Expected: `ridenow-prod-private-1`, `ridenow-prod-private-2`, `ridenow-prod-public-1`, `ridenow-prod-public-2`, with two different zones.

Load balancer discovery tags:

```bash
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID Name=tag:kubernetes.io/role/elb,Values=1 \
  --query 'length(Subnets)'
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID Name=tag:kubernetes.io/role/internal-elb,Values=1 \
  --query 'length(Subnets)'
```

Expected: `2` and `2`.

Two NAT gateways, both `available`:

```bash
aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=$VPC_ID Name=state,Values=available \
  --query 'NatGateways[].[NatGatewayId,SubnetId]' --output text
```

Expected: two lines, each NAT in a different public subnet.

Default routes: public tables go to the internet gateway, private tables to a NAT:

```bash
aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC_ID \
  --query 'RouteTables[].Routes[?DestinationCidrBlock==`0.0.0.0/0`].[GatewayId,NatGatewayId]' --output text
```

Expected: one `igw-...` row and two `nat-...` rows (the other column shows `None`).

The database security group allows only PostgreSQL, and only from the cluster security group:

```bash
aws ec2 describe-security-groups --group-ids $(exp network-DbSecurityGroupId) \
  --query 'SecurityGroups[0].IpPermissions[].[FromPort,ToPort,UserIdGroupPairs[0].GroupId]' --output text
echo "cluster SG: $(exp network-NodeSecurityGroupId)"
aws ec2 describe-security-groups --group-ids $(exp network-DbSecurityGroupId) \
  --query 'length(SecurityGroups[0].IpPermissions[].IpRanges[?CidrIp==`0.0.0.0/0`][])'
```

Expected: `5432  5432  sg-...` where the `sg-...` equals the cluster SG printed below it, then `0` (nothing is open to the internet).

The six exports exist:

```bash
stack_outputs 02-network
```

Expected: six rows: `DbSecurityGroupId`, `NodeSecurityGroupId`, `PrivateSubnetIds`, `PublicSubnetIds`, `VpcCidr`, `VpcId`. Each is exported as `ridenow-prod-network-<OutputKey>`, so `exp network-VpcId` returns the VPC id.

## Final check

Run this once the whole deployment is finished. It only reads.

```bash
stack_status 02-network
```

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

Next: `03-ecr.md`.
