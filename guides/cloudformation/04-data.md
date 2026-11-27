# 04 - Data (KMS, DB subnet group, RDS PostgreSQL)

You create one KMS key, one DB subnet group and six encrypted PostgreSQL RDS instances (one per service) by hand in the console. Region `ap-southeast-1`, environment `prod`. Values come from `iac/stacks/04-data.yaml` and `iac/params/prod.json`.

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `DbKmsKey` | KMS key (symmetric) | no name; alias below |
| `DbKmsAlias` | KMS alias | `alias/ridenow-prod-rds` |
| `DbSubnetGroup` | RDS DB subnet group | `ridenow-prod-db-subnet-group` (the template sets no name; this guide fixes one) |
| `UserDb` | RDS DB instance | `ridenow-prod-user-db` |
| `DriverDb` | RDS DB instance | `ridenow-prod-driver-db` |
| `TripDb` | RDS DB instance | `ridenow-prod-trip-db` |
| `PaymentDb` | RDS DB instance | `ridenow-prod-payment-db` |
| `MatchingDb` | RDS DB instance | `ridenow-prod-matching-db` |
| `NotificationDb` | RDS DB instance | `ridenow-prod-notification-db` |

## Depends on

Only [02-network.md](./02-network.md). Finish that guide first. The forms below ask for these values; you pick each one by name from a list, so you only need the ids if you want to double-check.

| Value | Created in | Where to find it in the console |
|---|---|---|
| VPC `ridenow-prod-vpc` | [02-network.md](./02-network.md) | **VPC -> Your VPCs**, search `ridenow-prod-vpc`, copy **VPC ID** (`vpc-...`) |
| Private subnet `ridenow-prod-private-1` | [02-network.md](./02-network.md) | **VPC -> Subnets**, search `ridenow-prod-private-1`, copy **Subnet ID** (`subnet-...`). Its **Availability Zone** is `ap-southeast-1a`. |
| Private subnet `ridenow-prod-private-2` | [02-network.md](./02-network.md) | **VPC -> Subnets**, search `ridenow-prod-private-2`, copy **Subnet ID** (`subnet-...`). Its **Availability Zone** is `ap-southeast-1b`. |
| DB security group `ridenow-prod-db-sg` | [02-network.md](./02-network.md) | **VPC -> Security groups**, search `ridenow-prod-db-sg`, copy **Security group ID** (`sg-...`). Check its **VPC ID** matches `ridenow-prod-vpc`. |

## Create the resources

Do the three steps in order.

### 1. KMS key (`DbKmsKey`, `DbKmsAlias`)

1. Go to **KMS -> Customer managed keys -> Create key**.
2. Set **Key type** to `Symmetric`.
3. Set **Key usage** to `Encrypt and decrypt`.
4. Under **Advanced options**, set **Key material origin** to `KMS`.
5. Under **Advanced options**, set **Regionality** to `Single-Region key`.
6. Select **Next**.
7. Set **Alias** to `ridenow-prod-rds`. The console shows it as `alias/ridenow-prod-rds`.
8. Set **Description** to `ridenow-prod RDS encryption key`.
9. Select **Next**.
10. Under **Key administrators**, tick your own IAM user or role.
11. Leave **Allow key administrators to delete this key** ticked, then select **Next**.
12. Under **Key users**, tick nothing, then select **Next**.
13. On **Review**, select **Finish**.
14. Open the new key and go to **Key policy -> Edit**.
15. Replace the whole policy with the JSON below, putting your 12-digit account id in place of `<ACCOUNT_ID>`.
16. Select **Save changes**.
17. Go to the **Key rotation** tab and select **Edit**.
18. Tick **Enable automatic key rotation**, then select **Save**.

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

Note: the wizard writes its own default policy, so the replacement above is what matches the template.

### 2. DB subnet group (`DbSubnetGroup`)

1. Go to **RDS -> Subnet groups -> Create DB subnet group**.
2. Set **Name** to `ridenow-prod-db-subnet-group`.
3. Set **Description** to `ridenow-prod RDS private subnets`.
4. Set **VPC** to `ridenow-prod-vpc`.
5. Under **Availability Zones**, tick the two zones of `ridenow-prod-private-1` and `ridenow-prod-private-2`.
6. Under **Subnets**, tick the two private subnets. Check the CIDRs in **VPC -> Subnets** and do not pick `ridenow-prod-public-*`.
7. Select **Create**.

### 3. The six RDS instances

Create the six databases one after another. Each has its own heading below with every value filled in. Creation takes 10 to 20 minutes per instance, so start the next one while the previous one is Creating.

#### 3.1 `UserDb` (ridenow-prod-user-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `UserDb` | `ridenow-prod-user-db` | `app_user` | `user_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-user-db`.
8. Set **Master username** to `app_user`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `user_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

#### 3.2 `DriverDb` (ridenow-prod-driver-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `DriverDb` | `ridenow-prod-driver-db` | `driver` | `driver_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-driver-db`.
8. Set **Master username** to `driver`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `driver_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

#### 3.3 `TripDb` (ridenow-prod-trip-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `TripDb` | `ridenow-prod-trip-db` | `trip` | `trip_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-trip-db`.
8. Set **Master username** to `trip`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `trip_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

#### 3.4 `PaymentDb` (ridenow-prod-payment-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `PaymentDb` | `ridenow-prod-payment-db` | `payment` | `payment_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-payment-db`.
8. Set **Master username** to `payment`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `payment_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

#### 3.5 `MatchingDb` (ridenow-prod-matching-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `MatchingDb` | `ridenow-prod-matching-db` | `matching` | `matching_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-matching-db`.
8. Set **Master username** to `matching`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `matching_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

#### 3.6 `NotificationDb` (ridenow-prod-notification-db)

| Template ID | DB instance identifier | Master username | Initial database name |
|---|---|---|---|
| `NotificationDb` | `ridenow-prod-notification-db` | `notification` | `notification_service` |

**Start**

1. Go to **RDS -> Databases -> Create database**.
2. Select **Standard create**.

**Engine**

3. Set **Engine type** to `PostgreSQL`.
4. Set **Engine version** to the latest `17.x` in the list.
5. Set **Templates** to `Dev/Test`.

**Availability and durability**

6. Under **Deployment options**, select **Multi-AZ DB instance**. Do not pick Multi-AZ DB cluster.

**Settings**

7. Set **DB instance identifier** to `ridenow-prod-notification-db`.
8. Set **Master username** to `notification`.
9. Set **Credentials management** to **Managed in AWS Secrets Manager**.
10. Set **Encryption key** (for the secret) to `alias/ridenow-prod-rds`.

**Instance configuration**

11. Select **Burstable classes** and choose `db.t4g.micro`.

**Storage**

12. Set **Storage type** to `General Purpose SSD (gp3)`.
13. Set **Allocated storage** to `20` GiB.
14. Untick **Enable storage autoscaling**.

**Connectivity**

15. Set **Compute resource** to **Don't connect to an EC2 compute resource**.
16. Set **Network type** to `IPv4`.
17. Set **Virtual private cloud (VPC)** to `ridenow-prod-vpc`.
18. Set **DB subnet group** to `ridenow-prod-db-subnet-group`.
19. Set **Public access** to `No`.
20. Under **VPC security group (firewall)**, select **Choose existing** and pick `ridenow-prod-db-sg`.
21. Remove `default` from the selected security groups.
22. Set **Availability Zone** to `No preference`.

**Database authentication**

23. Select **Password authentication**.

**Monitoring**

24. Untick **Turn on Performance Insights**.
25. Untick **Enable Enhanced monitoring**.

**Additional configuration**

26. Set **Initial database name** to `notification_service`.
27. Tick **Enable automated backups**.
28. Set **Backup retention period** to `30` days.
29. Tick **Enable encryption**.
30. Set **AWS KMS key** to `alias/ridenow-prod-rds`.
31. Leave **Enable auto minor version upgrade** ticked.
32. Untick **Enable deletion protection**.
33. Select **Create database**.

Notes: leave everything not listed at its default. The template sets `DeletionPolicy: Snapshot`; when you delete an instance later, keep "Create final snapshot" ticked.

## Values to record

Copy these twelve values once all six instances show `Available`. Open **RDS -> Databases**, select the instance, then:

- Endpoint: **Connectivity & security** tab, **Endpoint** (`<identifier>.<random>.ap-southeast-1.rds.amazonaws.com`).
- Secret ARN: **Configuration** tab, **Master Credentials ARN** (`arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:rds!db-...`).

| Output_Equivalent | Value | Console location | Consumed by |
|---|---|---|---|
| `UserDbEndpoint` | endpoint of `ridenow-prod-user-db` | RDS -> Databases -> `ridenow-prod-user-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `UserDbSecretArn` | master secret ARN of `ridenow-prod-user-db` | same instance -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |
| `DriverDbEndpoint` | endpoint of `ridenow-prod-driver-db` | `ridenow-prod-driver-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `DriverDbSecretArn` | master secret ARN of `ridenow-prod-driver-db` | `ridenow-prod-driver-db` -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |
| `TripDbEndpoint` | endpoint of `ridenow-prod-trip-db` | `ridenow-prod-trip-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `TripDbSecretArn` | master secret ARN of `ridenow-prod-trip-db` | `ridenow-prod-trip-db` -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |
| `PaymentDbEndpoint` | endpoint of `ridenow-prod-payment-db` | `ridenow-prod-payment-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `PaymentDbSecretArn` | master secret ARN of `ridenow-prod-payment-db` | `ridenow-prod-payment-db` -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |
| `MatchingDbEndpoint` | endpoint of `ridenow-prod-matching-db` | `ridenow-prod-matching-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `MatchingDbSecretArn` | master secret ARN of `ridenow-prod-matching-db` | `ridenow-prod-matching-db` -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |
| `NotificationDbEndpoint` | endpoint of `ridenow-prod-notification-db` | `ridenow-prod-notification-db` -> Connectivity & security -> Endpoint | `07-eks-addons.md` |
| `NotificationDbSecretArn` | master secret ARN of `ridenow-prod-notification-db` | `ridenow-prod-notification-db` -> Configuration -> Master Credentials ARN | `07-eks-addons.md` |

## Post-Deploy

None. The inbound rule that lets the cluster reach the databases is created in `07-eks-addons.md`.

## Verify

Run these in a terminal with the AWS CLI signed in to the same account, Region `ap-southeast-1`. They use the literal names from this guide, so nothing needs to be set first.

```bash
aws rds describe-db-instances --region ap-southeast-1 \
  --query "DBInstances[?starts_with(DBInstanceIdentifier,'ridenow-prod-')].[DBInstanceIdentifier,DBInstanceStatus,StorageEncrypted,MultiAZ,PubliclyAccessible,BackupRetentionPeriod]" \
  --output table
aws rds describe-db-subnet-groups --region ap-southeast-1 --db-subnet-group-name ridenow-prod-db-subnet-group \
  --query "DBSubnetGroups[0].[DBSubnetGroupName,VpcId,Subnets[].SubnetIdentifier]" --output json
aws kms get-key-rotation-status --region ap-southeast-1 --key-id alias/ridenow-prod-rds --query KeyRotationEnabled --output text
```

To check one instance by name, for example the user database:

```bash
aws rds describe-db-instances --region ap-southeast-1 --db-instance-identifier ridenow-prod-user-db \
  --query "DBInstances[0].[DBInstanceStatus,Endpoint.Address,MasterUserSecret.SecretArn,VpcSecurityGroups[].VpcSecurityGroupId]" --output json
```

Expected: six rows, each `available`, `True`, `True`, `False`, `30`; then the subnet group with the VPC id of `ridenow-prod-vpc` and the two private subnet ids from "Depends on"; then `True`. The single-instance check shows `available`, the endpoint, the secret ARN, and one `sg-...` equal to the `ridenow-prod-db-sg` id. If a row is missing or not `available`, open RDS -> Databases -> that instance -> Logs & events.

Next: `05-messaging.md`.
