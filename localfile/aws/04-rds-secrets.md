# 04 - RDS + Secrets Manager: one database per service

Goal: a managed PostgreSQL database for each service that owns data, with its
master credentials stored in Secrets Manager (never in a config file or image).
This upholds the **database-per-service** rule - no shared database, no
cross-service tables.

Time: ~30 min (Multi-AZ instances take several minutes each to create). Cost: RDS
bills hourly and Multi-AZ doubles the instance hours — a per-service Multi-AZ
fleet is a real steady-state cost. Tear down environments you decommission.

---

## Which services need a database

Each of these owns its own data and gets its **own** RDS instance + DB name:

| Service | DB name (the code expects this) | Default local user |
|---------|---------------------------------|--------------------|
| user-service | `user_service` | `app_user` |
| driver-service | `driver_service` | `driver` |
| trip-service | `trip_service` | `trip` |
| payment-service | `payment_service` | `payment` |
| matching-service | `matching_service` | `matching` |
| notification-worker | `notification_service` | `notification` |

In the cloud the **username/password come from Secrets Manager** (below), and
the service reads `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` from env - the same
variable names it uses locally. The DB name in the JDBC URL must match the table
above because Flyway/JPA validate against it.

> One Multi-AZ instance per service is the production shape: it keeps the
> database-per-service ownership boundary hard (no shared instance to couple
> teams or failure domains) and gives each service independent failover,
> scaling, and backup windows. This matches `../../iac/stacks/04-data.yaml`
> (which provisions user/driver/trip/payment; matching and notification are
> added alongside the messaging layer).

---

## 1. Create a DB subnet group (once)

RDS needs to know which (private) subnets it may live in.

1. Console -> **RDS** -> **Subnet groups** -> **Create DB subnet group**.
2. Name: `ridenow-db-subnets`. VPC: the `ridenow` VPC.
3. Add the **three private** subnets (all three AZs) so Multi-AZ has room to
   place a standby.
4. **Create**.

---

## 2. Create one RDS instance per service

Repeat these steps for each service in the table. The example uses
**trip-service**; change the three bold values each time.

1. RDS -> **Databases** -> **Create database**.
2. **Standard create**. Engine: **PostgreSQL** (pick version 17 to match local).
3. Templates: **Production**.
4. **Availability**: **Multi-AZ DB instance** (a standby in a second AZ for
   automatic failover).
5. **DB instance identifier**: **`ridenow-prod-trip-db`**.
6. **Master username**: **`trip`** (use the table's user).
7. **Credentials management**: choose **Managed in AWS Secrets Manager**. This
   generates the password and stores the secret for you - no plaintext anywhere.
8. **Instance configuration**: **db.r6g.large** (memory-optimized, production).
9. **Storage**: 100 GiB gp3; leave **autoscaling** on with a sensible cap.
10. **Connectivity**:
    - VPC: `ridenow`.
    - DB subnet group: `ridenow-db-subnets`.
    - Public access: **No**.
    - VPC security group: **Choose existing** -> `ridenow-db-sg` (from guide 02).
    - Availability Zone: no preference.
11. **Additional configuration**:
    - **Initial database name**: **`trip_service`** (use the table's DB name).
    - **Backup retention**: **30 days**.
    - **Deletion protection**: **leave unchecked** (so teardown stays simple;
      the `DeletionPolicy=Snapshot` on the stack still keeps a final snapshot).
12. **Create database**. Multi-AZ provisioning takes several minutes to
    **Available**.

Repeat for `ridenow-prod-user-db` / `app_user` / `user_service`,
`ridenow-prod-driver-db` / `driver` / `driver_service`,
`ridenow-prod-payment-db` / `payment` / `payment_service`,
`ridenow-prod-matching-db` / `matching` / `matching_service`,
`ridenow-prod-notification-db` / `notification` / `notification_service`.

---

## 3. Find each secret and endpoint

For each instance:

1. RDS -> Databases -> open e.g. `ridenow-prod-trip-db`.
2. **Connectivity & security** -> copy the **Endpoint** (e.g.
   `ridenow-prod-trip-db.abcd1234.ap-southeast-1.rds.amazonaws.com`). This is the
   host in `SPRING_DATASOURCE_URL`.
3. Under credentials, click through to the **Secrets Manager** secret it created.
   Note the secret name/ARN. The secret JSON holds `username` and `password`.

You'll wire these into the pods in guide 06 via External Secrets, which pulls the
Secrets Manager secret and projects it as a Kubernetes Secret — with automatic
rotation, no plaintext in any manifest.

---

## Verify

- Each RDS instance shows **Available** and **Multi-AZ**, each private (no public
  endpoint).
- Each has a Secrets Manager secret with `username`/`password`.
- `ridenow-db-sg` is attached to each, so only in-VPC traffic on 5432 is allowed.

## Clean up

RDS is a top cost (Multi-AZ doubles the instance hours). Deletion protection is
off, so teardown is straightforward: RDS -> select each DB -> **Actions** ->
**Delete**. A final snapshot is retained automatically. Tear down only when
decommissioning the environment.

Next: `05-eks-cluster.md`.
