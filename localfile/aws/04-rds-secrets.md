# 04 - RDS + Secrets Manager: one database per service

Goal: a managed PostgreSQL database for each service that owns data, with its
master credentials stored in Secrets Manager (never in a config file or image).
This upholds the **database-per-service** rule - no shared database, no
cross-service tables.

Time: ~30 min (RDS instances take several minutes each to create). Cost: RDS
bills hourly; Multi-AZ doubles it. Use the smallest instance for learning and
**delete when done**.

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

> Doing six instances is repetitive but correct for the architecture. If cost is
> a concern while learning, you *can* run fewer instances and put each service's
> schema in its own **database** on a shared instance - but keep the databases
> separate so the ownership boundary still holds. The guide below does one
> instance per service, matching `../../iac/stacks/04-data.yaml`.

---

## 1. Create a DB subnet group (once)

RDS needs to know which (private) subnets it may live in.

1. Console -> **RDS** -> **Subnet groups** -> **Create DB subnet group**.
2. Name: `ridenow-db-subnets`. VPC: the `ridenow` VPC.
3. Add the **two private** subnets (both AZs).
4. **Create**.

---

## 2. Create one RDS instance per service

Repeat these steps for each service in the table. The example uses
**trip-service**; change the three bold values each time.

1. RDS -> **Databases** -> **Create database**.
2. **Standard create**. Engine: **PostgreSQL** (pick version 17 to match local).
3. Templates: **Dev/Test** (or Production if you want Multi-AZ).
4. **DB instance identifier**: **`ridenow-trip`**.
5. **Master username**: **`trip`** (use the table's user).
6. **Credentials management**: choose **Managed in AWS Secrets Manager**. This
   generates the password and stores the secret for you - no plaintext anywhere.
7. **Instance configuration**: Burstable -> **db.t4g.micro** (cheapest).
8. **Storage**: 20 GiB gp3 is plenty; turn **autoscaling** off for a lab.
9. **Connectivity**:
   - VPC: `ridenow`.
   - DB subnet group: `ridenow-db-subnets`.
   - Public access: **No**.
   - VPC security group: **Choose existing** -> `ridenow-db-sg` (from guide 02).
   - Availability Zone: no preference.
10. **Additional configuration** -> **Initial database name**: **`trip_service`**
    (use the table's DB name). This creates the database the service connects to.
11. **Create database**. It takes a few minutes to become **Available**.

Repeat for `ridenow-user` / `app_user` / `user_service`, `ridenow-driver` /
`driver` / `driver_service`, `ridenow-payment` / `payment` / `payment_service`,
`ridenow-matching` / `matching` / `matching_service`, `ridenow-notification` /
`notification` / `notification_service`.

---

## 3. Find each secret and endpoint

For each instance:

1. RDS -> Databases -> open e.g. `ridenow-trip`.
2. **Connectivity & security** -> copy the **Endpoint** (e.g.
   `ridenow-trip.abcd1234.ap-southeast-1.rds.amazonaws.com`). This is the host in
   `SPRING_DATASOURCE_URL`.
3. Under credentials, click through to the **Secrets Manager** secret it created.
   Note the secret name/ARN. The secret JSON holds `username` and `password`.

You'll wire these into the pods in guide 06 (either via External Secrets pulling
the Secrets Manager secret, or by creating the Kubernetes Secret by hand from
these values).

---

## Verify

- Six RDS instances show **Available**, each private (no public endpoint).
- Each has a Secrets Manager secret with `username`/`password`.
- `ridenow-db-sg` is attached to each, so only in-VPC traffic on 5432 is allowed.

## Clean up

RDS is a top cost. When you stop: RDS -> select each DB -> **Actions** ->
**Delete** (uncheck "create final snapshot" for a lab to avoid snapshot storage).
Or **Stop** them temporarily (RDS auto-starts after 7 days, so delete if you're
done).

Next: `05-eks-cluster.md`.
