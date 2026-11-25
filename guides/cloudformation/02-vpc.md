# 02 - VPC, NAT and security groups

Stack `ridenow-<env>-02-network` from `iac/stacks/02-network.yaml`. No dependencies.

## What it creates

- One VPC (`10.30.0.0/16` in `prod`) with DNS support.
- Two public and two private subnets, one pair per Availability Zone.
- An internet gateway, and **one NAT gateway per AZ** (the main steady cost here).
- Route tables: public subnets route to the internet gateway; each private subnet routes to the NAT in its own AZ.
- Subnet tags the load balancer controller needs: `kubernetes.io/role/elb` (public) and `kubernetes.io/role/internal-elb` (private).
- A cluster security group (pods) and a database security group (PostgreSQL, private only).

## Configure

```bash
params 02-network
```

Expected: `Environment=prod` and `VpcCidr=10.30.0.0/16`.

Each environment needs a CIDR that does not overlap the others, so dev, staging and prod can coexist.
To use another CIDR for one run:

```bash
cfn_deploy 02-network VpcCidr=10.40.0.0/16
```

## Deploy

```bash
cfn_deploy 02-network
```

Expected last line: `Successfully created/updated stack - ridenow-prod-02-network`. The NAT gateways take 3-5 minutes.

## Verify

```bash
stack_status 02-network
VPC_ID=$(exp network-VpcId); echo $VPC_ID
```

Expected: `CREATE_COMPLETE` and an id like `vpc-0abc...`.

VPC state, CIDR and DNS:

```bash
aws ec2 describe-vpcs --vpc-ids $VPC_ID --query 'Vpcs[0].[CidrBlock,State]' --output text
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsSupport   --query 'EnableDnsSupport.Value'   --output text
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsHostnames --query 'EnableDnsHostnames.Value' --output text
```

Expected: `10.30.0.0/16  available`, then `True`, then `True`.

Four subnets, two per AZ:

```bash
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID \
  --query 'sort_by(Subnets,&Tags[?Key==`Name`]|[0].Value)[].[Tags[?Key==`Name`]|[0].Value,AvailabilityZone,CidrBlock]' \
  --output text
```

Expected: `ridenow-prod-private-1`, `-private-2`, `-public-1`, `-public-2`, with two different zones.

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

Expected: one `igw-...` row and two `nat-...` rows.

Database security group is private and allows only PostgreSQL:

```bash
aws ec2 describe-security-groups --group-ids $(exp network-DbSecurityGroupId) \
  --query 'SecurityGroups[0].IpPermissions[].[FromPort,ToPort]' --output text
aws ec2 describe-security-groups --group-ids $(exp network-DbSecurityGroupId) \
  --query 'length(SecurityGroups[0].IpPermissions[].IpRanges[?CidrIp==`0.0.0.0/0`][])'
```

Expected: `5432  5432`, then `0` (nothing is open to the internet).

Six exports:

```bash
aws cloudformation list-exports \
  --query "Exports[?starts_with(Name,'ridenow-$ENV-network-')].Name" --output text | tr '\t' '\n' | sort
```

Expected: `DbSecurityGroupId`, `NodeSecurityGroupId`, `PrivateSubnetIds`, `PublicSubnetIds`, `VpcCidr`, `VpcId`.
(`NodeSecurityGroupId` is the cluster security group under its older name.)

## If it fails

```bash
stack_failures 02-network
```

`VpcLimitExceeded` or `AddressLimitExceeded` (Elastic IPs): the account is at its quota. Release unused
resources or request a limit increase. `InvalidParameterValue` on `VpcCidr`: the CIDR must be a valid /16.

Next: `03-ecr.md`.