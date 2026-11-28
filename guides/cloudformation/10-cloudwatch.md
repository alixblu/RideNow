# 10 - CloudWatch (pod logs, control-plane logs, alarms, dashboard, email notification)

You create the CloudWatch resources of RideNow by hand in the AWS Console, following `iac/stacks/09-observability.yaml` (read only). Region `ap-southeast-1`, environment `prod`, parameters from `iac/params/prod.json` layer `09-observability`.

CloudWatch does five jobs in RideNow:

1. **Pod logs.** Fargate has no nodes and no DaemonSets, so the built-in Fargate log router (Fluent Bit) ships the container logs of the seven services to a CloudWatch Logs group. Logs Insights queries then find every log line of one request from its X-Ray trace id (guide `09-xray-tracing.md`).
2. **Control-plane logs.** The EKS cluster `ridenow-prod` writes its API, audit, authenticator, controller-manager and scheduler logs to a second log group. This group is created and switched on in `06-eks-cluster.md`; this guide only reads it.
3. **Alarms.** 21 alarms watch the three dead-letter queues, the age of the three work queues, SNS delivery failures, CPU and free storage of the six RDS instances, Valkey memory and ALB 5xx responses.
4. **Dashboard.** One dashboard, `ridenow-prod`, shows the main health signals on one page.
5. **Notification.** Every alarm sends its state changes (ALARM and OK) to the SNS topic `ridenow-prod-alarms`, which delivers them by email.

The ALB is created by the AWS Load Balancer Controller from the Ingress, not by a CloudFormation stack, so the ALB alarm needs the Ingress from `06-eks-cluster.md` (step 9) to have an address. Create this guide after that step if you want the ALB alarm. The other 20 alarms do not depend on it.

## What it creates

| Template logical ID | AWS resource type | Resolved name |
|---|---|---|
| `PodLogGroup` | CloudWatch Logs log group | `/aws/eks/ridenow-prod/fargate` (retention 14 days) |
| `TraceIdQuery` | Logs Insights saved query | `ridenow-prod/by-trace-id` |
| `ErrorsByServiceQuery` | Logs Insights saved query | `ridenow-prod/errors-by-service` |
| `AlarmTopic` | SNS topic | `ridenow-prod-alarms` |
| `AlarmEmailSubscription` | SNS subscription (protocol `email`) | topic `ridenow-prod-alarms` to your `AlarmEmail` address |
| `AlarmTopicPolicy` | SNS topic access policy | on `ridenow-prod-alarms` (CloudWatch alarms of this account may publish) |
| `DlqDepthAlarms` (3) | CloudWatch alarms | `ridenow-prod-{matching,payment,notifications}-dlq-depth` |
| `QueueAgeAlarms` (3) | CloudWatch alarms | `ridenow-prod-{matching,payment,notifications}-queue-age` |
| `EventsDeliveryFailedAlarm` (1) | CloudWatch alarm | `ridenow-prod-events-delivery-failed` |
| `DbCpuAlarms`, `DbFreeStorageAlarms` (6 each, 12) | CloudWatch alarms | `ridenow-prod-<service>-db-{cpu,free-storage}` for `user`, `driver`, `trip`, `payment`, `matching`, `notification` |
| `CacheMemoryAlarm` (1) | CloudWatch alarm | `ridenow-prod-redis-memory` |
| `Alb5xxAlarm` (1) | CloudWatch alarm | `ridenow-prod-alb-5xx` |
| `Dashboard` | CloudWatch dashboard | `ridenow-prod` |
| (not in the template) | Kubernetes namespace and ConfigMap | `aws-observability` and `aws-logging` from `iac/k8s/01-aws-logging.yaml` |

The alarm total is 3 + 3 + 1 + 12 + 1 + 1 = 21. The log group `/aws/eks/ridenow-prod/cluster` and the log permissions of the pod execution role are not created here: they come from `06-eks-cluster.md` and `01-iam.md`. The ConfigMap is applied in Post-Deploy.

## Depends on

Look up each value in the console and keep it at hand. Check that the region selector at the top right reads **Asia Pacific (Singapore) ap-southeast-1**.

| Value | Created in | Where to find it in the console |
|---|---|---|
| `ACCOUNT_ID` (12 digits) | your AWS account | Click your account name at the top right. Copy **Account ID**. |
| `AWS_REGION` | fixed | `ap-southeast-1` |
| `ALARM_EMAIL` | your choice | An address you can read. SNS sends a confirmation mail to it. Leave it empty to create the topic without a subscription. |
| Fargate pod execution role `ridenow-prod-eks-fargate-pod-execution-role` with the inline policy `fargate-log-router-logs` | [01-iam.md](./01-iam.md) | **IAM -> Roles** -> `ridenow-prod-eks-fargate-pod-execution-role` -> **Permissions** tab. The policy `fargate-log-router-logs` must be listed under **Permissions policies** as `Inline`. Without it the log router gets `AccessDeniedException` and no pod log arrives. |
| Cluster `ridenow-prod` and its `aws-observability` Fargate profile | [06-eks-cluster.md](./06-eks-cluster.md) | **EKS -> Clusters** -> `ridenow-prod` -> **Compute** tab -> **Fargate profiles**. The profile `aws-observability` must be `Active`. |
| Control-plane log group `/aws/eks/ridenow-prod/cluster` with the five log types on | [06-eks-cluster.md](./06-eks-cluster.md) | **CloudWatch -> Logs -> Log management**, search `/aws/eks/ridenow-prod/cluster`. Or **EKS -> Clusters** -> `ridenow-prod` -> **Observability** tab -> **Control plane logging**. |
| Six DB instance identifiers `ridenow-prod-user-db`, `ridenow-prod-driver-db`, `ridenow-prod-trip-db`, `ridenow-prod-payment-db`, `ridenow-prod-matching-db`, `ridenow-prod-notification-db` | [04-data.md](./04-data.md) | **RDS -> Databases**, column **DB identifier**. All six must show **Status** `Available`. The alarms use this identifier as the dimension `DBInstanceIdentifier`. |
| Work queues `ridenow-prod-matching`, `ridenow-prod-payment`, `ridenow-prod-notifications` | [05-messaging.md](./05-messaging.md), step 3 | **Amazon SQS -> Queues**, search `ridenow-prod-`. The alarms use the queue **Name** (not the URL) as the dimension `QueueName`. |
| Dead-letter queues `ridenow-prod-matching-dlq`, `ridenow-prod-payment-dlq`, `ridenow-prod-notifications-dlq` | [05-messaging.md](./05-messaging.md), step 2 | **Amazon SQS -> Queues**, search `-dlq`. Three rows. |
| SNS topic `ridenow-prod-events` | [05-messaging.md](./05-messaging.md), step 1 | **Amazon SNS -> Topics** -> `ridenow-prod-events`. The alarm uses the topic **Name** as the dimension `TopicName`. This is the event topic, not the alarm topic made in this guide. |
| Valkey nodes `ridenow-prod-redis-001` and `ridenow-prod-redis-002` | [05-messaging.md](./05-messaging.md), step 7 | **Amazon ElastiCache -> Valkey caches** -> `ridenow-prod-redis` -> **Nodes** (or **Shards and nodes**) tab. Two nodes, one primary and one replica. Their names are the dimension `CacheClusterId`. If the console shows other node names, use those. |
| `ALB_FULL_NAME`, the form `app/<name>/<id>` | the AWS Load Balancer Controller, from the Ingress in [06-eks-cluster.md](./06-eks-cluster.md), step 9 | **EC2 -> Load Balancers**, the row whose name starts with `k8s-ridenow`. Open it, copy **ARN**, and keep the part after `loadbalancer/`, for example `app/k8s-ridenow-abc123/0123456789abcdef`. |
| `X-Trace-Id` response header | [09-xray-tracing.md](./09-xray-tracing.md), step 5 | The services return it on each request. Post-Deploy uses it to search the logs. Skip it if you do not run the trace query. |

Notes on the table:

- The ALB is not in any stack. The Load Balancer Controller creates it from the Ingress, so you read its `app/<name>/<id>` value in the EC2 console. The alarm needs only this value.
- To check the value from WSL, list the ALB ARN and keep the part after `loadbalancer/`:

  ```bash
  aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-ridenow')].LoadBalancerArn" --output text \
    | sed 's#.*:loadbalancer/##'
  ```

  Expected: one line of the form `app/k8s-ridenow-<hash>/<16 hex characters>`. No output means the Ingress has no ALB yet.
- If the Ingress has no address yet, leave `ALB_FULL_NAME` empty. You then create 20 alarms, and the ALB alarm later, when the ALB exists.
- Stop if one of the DB identifiers, queues or Valkey nodes is missing: its alarms would sit in `INSUFFICIENT_DATA` for ever.

## Create the resources

Everything below is done in the console, in region **Asia Pacific (Singapore) ap-southeast-1**. The steps follow the order of `iac/stacks/09-observability.yaml`. Replace `ACCOUNT_ID` with your account ID (see **Depends on**). Every name is case-sensitive.

Two conventions are used in all alarm steps:

- The template sets `EvaluationPeriods` only. In the console wizard this means **Datapoints to alarm** equals the number of evaluation periods, for example `3 out of 3`.
- Every alarm sends to the same topic for both states: **In alarm** and **OK** go to `ridenow-prod-alarms`. **Insufficient data** gets no action, so you get no mail while an alarm starts up.

### 1. Pod log group (`PodLogGroup`)

The Fargate log router writes here with `auto_create_group false`, so you create the group first and set its retention yourself.

1. Go to **CloudWatch -> Logs -> Log management -> Create log group**.
2. Set **Log group name** to `/aws/eks/ridenow-prod/fargate`.
3. Set **Retention setting** to `2 weeks (14 days)`. This is the `LogRetentionDays` default of 14.
4. Leave **Log class** at `Standard`.
5. Leave **KMS key ARN** empty.
6. Under **Tags**, choose **Add new tag**. Set **Key** to `Environment` and **Value** to `prod`.
7. Choose **Create**.

Check: the group appears in **Log management** with **Retention** `2 weeks`. A group without retention keeps logs for ever and its storage cost never stops growing, so do not skip step 3. The same applies to `/aws/eks/ridenow-prod/cluster` from `06-eks-cluster.md`: both groups stop growing after `LogRetentionDays` days.

The namespace `aws-observability` is already covered by the `aws-observability` Fargate profile you created in `06-eks-cluster.md`, so no profile change is needed. The ConfigMap that points the router at this group is applied in Post-Deploy, after the group exists.

If the router reports `AccessDeniedException` later, the pod execution role lacks the permissions. Edit the role `ridenow-prod-eks-fargate-pod-execution-role` and attach the inline policy `fargate-log-router-logs` as described in `01-iam.md`. It allows `logs:CreateLogStream`, `logs:DescribeLogStreams` and `logs:PutLogEvents` on `/aws/eks/ridenow-prod/fargate` and its streams.

### 2. Alarm topic and email subscription (`AlarmTopic`, `AlarmEmailSubscription`)

1. Go to **Amazon SNS -> Topics -> Create topic**.
2. Set **Type** to `Standard`.
3. Set **Name** to `ridenow-prod-alarms`.
4. Leave **Encryption** disabled (see the reason in step 3).
5. Under **Tags**, set **Key** to `Environment` and **Value** to `prod`.
6. Choose **Create topic**.
7. Copy the topic ARN. It has the form `arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-alarms`.

Skip the rest of this step if `ALARM_EMAIL` is empty. The template then creates the topic without a subscription, and alarms still change state in the console and on the dashboard.

1. In the topic, go to the **Subscriptions** tab and choose **Create subscription**.
2. Leave **Topic ARN** at `ridenow-prod-alarms`.
3. Set **Protocol** to `Email`.
4. Set **Endpoint** to your `ALARM_EMAIL` address.
5. Choose **Create subscription**.

The status is `Pending confirmation` until you open the mail from AWS Notifications and choose **Confirm subscription**. You confirm it in Post-Deploy.

### 3. Topic access policy and why there is no KMS key (`AlarmTopicPolicy`)

**Why the topic has no encryption.** The alarm topic has no KMS key on purpose. CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed key `aws/sns`, because its key policy cannot be edited to allow `cloudwatch.amazonaws.com`, so delivery would fail without any error. The message holds only the alarm name, its state and metric values, no secrets. To encrypt the topic later, use a customer-managed key whose key policy allows `cloudwatch.amazonaws.com`. The event topic in `05-messaging.md` is left unencrypted for the same reason.

**The access policy.** It lets CloudWatch alarms of your account, and only those, publish to the topic.

1. Open the topic `ridenow-prod-alarms` and choose **Edit**.
2. Expand **Access policy - optional**.
3. Replace the JSON with the policy below. Replace `ACCOUNT_ID` (three places) and keep the region `ap-southeast-1`. The topic ARN is the one you copied in step 2.
4. Choose **Save changes**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudWatchAlarms",
      "Effect": "Allow",
      "Principal": { "Service": "cloudwatch.amazonaws.com" },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-alarms",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "ACCOUNT_ID" },
        "ArnLike": { "aws:SourceArn": "arn:aws:cloudwatch:ap-southeast-1:ACCOUNT_ID:alarm:*" }
      }
    }
  ]
}
```

### 4. Alarms

You create 21 alarms in four groups. All use **Threshold type** `Static`. In every wizard, the pages are:

- **Specify metric and conditions**: pick the metric, then **Statistic**, **Period**, the comparison and the threshold. Open **Additional configuration** to set **Datapoints to alarm** and **Missing data treatment**.
- **Configure actions**: under **Notification**, set **Alarm state trigger** to `In alarm`, **Send a notification to the following SNS topic** to `Select an existing SNS topic`, and pick `ridenow-prod-alarms`. Choose **Add notification**, set the trigger to `OK` and pick the same topic. Remove the default **Auto Scaling**, **EC2** and **Systems Manager** actions if the wizard offers them.
- **Add name and description**: **Alarm name** and **Alarm description** from the tables below.
- **Preview and create**: choose **Create alarm**.

To start a wizard, go to **CloudWatch -> Alarms -> All alarms -> Create alarm -> Select metric**.

#### 4.1 Messaging alarms (7)

SQS and SNS publish metrics only while there is traffic, so for these seven alarms set **Missing data treatment** to `Treat missing data as good (not breaching)`. Skip this group if messaging is off (`EnableMessaging` is `false`).

**DLQ depth (3 alarms).** Metric path: **SQS -> Queue Metrics**, metric name `ApproximateNumberOfMessagesVisible`, **QueueName** = the DLQ name. Create one alarm per row.

| Alarm name | QueueName (dimension) | Alarm description |
|---|---|---|
| `ridenow-prod-matching-dlq-depth` | `ridenow-prod-matching-dlq` | `A message is waiting in ridenow-prod-matching-dlq.` |
| `ridenow-prod-payment-dlq-depth` | `ridenow-prod-payment-dlq` | `A message is waiting in ridenow-prod-payment-dlq.` |
| `ridenow-prod-notifications-dlq-depth` | `ridenow-prod-notifications-dlq` | `A message is waiting in ridenow-prod-notifications-dlq.` |

For each: **Statistic** `Maximum`, **Period** `1 minute` (60 s), **Conditions** `Greater` than `0`, **Datapoints to alarm** `1 out of 1`.

**Queue age (3 alarms).** Metric path: **SQS -> Queue Metrics**, metric name `ApproximateAgeOfOldestMessage`, **QueueName** = the work queue name.

| Alarm name | QueueName (dimension) | Alarm description |
|---|---|---|
| `ridenow-prod-matching-queue-age` | `ridenow-prod-matching` | `The oldest message in ridenow-prod-matching is older than the threshold.` |
| `ridenow-prod-payment-queue-age` | `ridenow-prod-payment` | `The oldest message in ridenow-prod-payment is older than the threshold.` |
| `ridenow-prod-notifications-queue-age` | `ridenow-prod-notifications` | `The oldest message in ridenow-prod-notifications is older than the threshold.` |

For each: **Statistic** `Maximum`, **Period** `1 minute`, **Conditions** `Greater` than `300` (`QueueAgeThresholdSeconds`), **Datapoints to alarm** `3 out of 3`.

**SNS delivery failures (1 alarm).** Metric path: **SNS -> Topic Metrics**, metric name `NumberOfNotificationsFailed`, **TopicName** = `ridenow-prod-events` (the event topic from `05-messaging.md`, not the alarm topic).

| Field | Value |
|---|---|
| **Alarm name** | `ridenow-prod-events-delivery-failed` |
| **Alarm description** | `SNS topic ridenow-prod-events failed to deliver a notification.` |
| **Statistic** | `Sum` |
| **Period** | `5 minutes` (300 s) |
| **Conditions** | `Greater` than `0` |
| **Datapoints to alarm** | `1 out of 1` |

#### 4.2 Database alarms (12)

One CPU alarm and one free-storage alarm per service, six services by two metrics. RDS publishes continuously, so leave **Missing data treatment** at the default `Treat missing data as missing`. Metric path: **RDS -> Per-Database Metrics**, pick the metric name, then the row whose **DBInstanceIdentifier** is `ridenow-prod-<service>-db`. **Statistic** is `Average` for all 12. In the wizard, **Period** `300` is `5 minutes`, **Greater** is `Greater than threshold` and **Lower** is `Lower than threshold`.

| # | Service | Metric | Condition and threshold | Period | Datapoints to alarm | Alarm name |
|---|---|---|---|---|---|---|
| 1 | `user` | `CPUUtilization` | `Greater` than `80` (percent) | 300 s | 3 out of 3 | `ridenow-prod-user-db-cpu` |
| 2 | `user` | `FreeStorageSpace` | `Lower` than `2147483648` (bytes) | 300 s | 1 out of 1 | `ridenow-prod-user-db-free-storage` |
| 3 | `driver` | `CPUUtilization` | `Greater` than `80` | 300 s | 3 out of 3 | `ridenow-prod-driver-db-cpu` |
| 4 | `driver` | `FreeStorageSpace` | `Lower` than `2147483648` | 300 s | 1 out of 1 | `ridenow-prod-driver-db-free-storage` |
| 5 | `trip` | `CPUUtilization` | `Greater` than `80` | 300 s | 3 out of 3 | `ridenow-prod-trip-db-cpu` |
| 6 | `trip` | `FreeStorageSpace` | `Lower` than `2147483648` | 300 s | 1 out of 1 | `ridenow-prod-trip-db-free-storage` |
| 7 | `payment` | `CPUUtilization` | `Greater` than `80` | 300 s | 3 out of 3 | `ridenow-prod-payment-db-cpu` |
| 8 | `payment` | `FreeStorageSpace` | `Lower` than `2147483648` | 300 s | 1 out of 1 | `ridenow-prod-payment-db-free-storage` |
| 9 | `matching` | `CPUUtilization` | `Greater` than `80` | 300 s | 3 out of 3 | `ridenow-prod-matching-db-cpu` |
| 10 | `matching` | `FreeStorageSpace` | `Lower` than `2147483648` | 300 s | 1 out of 1 | `ridenow-prod-matching-db-free-storage` |
| 11 | `notification` | `CPUUtilization` | `Greater` than `80` | 300 s | 3 out of 3 | `ridenow-prod-notification-db-cpu` |
| 12 | `notification` | `FreeStorageSpace` | `Lower` than `2147483648` | 300 s | 1 out of 1 | `ridenow-prod-notification-db-free-storage` |

Alarm descriptions, with `<service>` replaced by the service in the row:

| Alarm name suffix | Alarm description |
|---|---|
| `-db-cpu` | `CPU of ridenow-prod-<service>-db is above the threshold.` |
| `-db-free-storage` | `Free storage of ridenow-prod-<service>-db is below the threshold.` |

The thresholds are the template defaults: `DbCpuThresholdPercent` 80 and `DbFreeStorageThresholdBytes` 2147483648 (2 GiB, 10% of the 20 GiB disk in `iac/params/prod.json`).

#### 4.3 Valkey alarm (1)

Skip this group if Valkey is off (`EnableRedis` is `false`). ElastiCache publishes per node, under the dimension `CacheClusterId`. The replication group `ridenow-prod-redis` has two nodes, `ridenow-prod-redis-001` and `ridenow-prod-redis-002`. The primary can move after a failover, so the alarm takes the **maximum of both nodes** with metric math. Leave **Missing data treatment** at the default `Treat missing data as missing`.

1. In the wizard, choose **Select metric**, open **ElastiCache -> Cache Node Metrics**, and tick `DatabaseMemoryUsagePercentage` for `ridenow-prod-redis-001` and for `ridenow-prod-redis-002`.
2. Choose **Select metric**. On the **Graphed metrics** tab, set **Statistic** to `Average` and **Period** to `5 minutes` for both rows. The wizard gives them the ids `m1` and `m2`.
3. On the same tab choose **Add math -> Start with empty expression**. Set **Details** to `MAX([m1,m2])` and **Label** to `DatabaseMemoryUsagePercentage`. (The template names the ids `n1`, `n2` and `e1`; the names do not matter.)
4. Clear the check box of `m1` and `m2` so that only the expression is evaluated.
5. Set **Conditions** `Greater` than `80` (`CacheMemoryThresholdPercent`) and **Datapoints to alarm** `3 out of 3`.
6. Set **Alarm name** to `ridenow-prod-redis-memory` and **Alarm description** to `Valkey memory usage of ridenow-prod-redis is above the threshold on a node.`

If the console shows other node names in **Cache Node Metrics**, use those, as noted in **Depends on**.

#### 4.4 ALB alarm (1)

The ALB is created by the AWS Load Balancer Controller from the Ingress, not by a stack, so you read its name in the EC2 console (**Depends on**). Skip this group if `ALB_FULL_NAME` is empty: the template creates no ALB alarm then. The ALB publishes metrics only while there is traffic, so set **Missing data treatment** to `Treat missing data as good (not breaching)`.

Metric path: **ApplicationELB -> Per AppELB Metrics**, the row whose **LoadBalancer** is `ALB_FULL_NAME` (the form `app/<name>/<id>`), metric name `HTTPCode_Target_5XX_Count`.

| Field | Value |
|---|---|
| **Alarm name** | `ridenow-prod-alb-5xx` |
| **Alarm description** | `Targets behind the ALB returned 5xx responses above the threshold.` |
| **Statistic** | `Sum` |
| **Period** | `1 minute` (60 s) |
| **Conditions** | `Greater` than `5` (`Alb5xxThreshold`) |
| **Datapoints to alarm** | `3 out of 3` |

### 5. Dashboard (`Dashboard`)

The dashboard `ridenow-prod` is one page of widgets on a 24-column grid. Widget rows (`y` is the grid row where the widget starts):

| Row (`y`) | Widgets, left to right | Present when |
|---|---|---|
| 1 (`y` 0, height 4) | **Alarm status**, full width (24), lists all 21 alarms of this guide | always |
| 2 (`y` 4, height 6) | **DLQ visible messages** (12 wide): `ApproximateNumberOfMessagesVisible` of the 3 DLQs, `Maximum`, 60 s. **Oldest message age (s)** (12 wide): `ApproximateAgeOfOldestMessage` of the 3 work queues, `Maximum`, 60 s | messaging on |
| 3 (`y` 10, height 6) | **RDS CPUUtilization** (12 wide): six lines, `Average`, 300 s, labels `user`, `driver`, `trip`, `payment`, `matching`, `notification`. **Valkey memory % (max of nodes)** (12 wide): `MAX` of the two nodes, `Average`, 300 s | RDS always, Valkey when on |
| 4 (`y` 16, height 6) | **ALB target 5xx** (12 wide): `HTTPCode_Target_5XX_Count`, `Sum`, 60 s | `ALB_FULL_NAME` set |
| 5 (`y` 22, height 6) | **ERROR count per service**, full width (24): Logs Insights widget, time series | always |

Create it:

1. Go to **CloudWatch -> Dashboards -> Create dashboard**.
2. Set **Dashboard name** to `ridenow-prod`. Choose **Create dashboard**.
3. In the **Add widget** dialog, add the widgets of the table, one by one. Use **Alarm status** for row 1 and **Line** with **Data source types** `Metrics` for rows 2 to 4. For row 5, choose **Line** with **Data source types** `Logs`, pick the log group `/aws/eks/ridenow-prod/fargate`, and paste this query:

   ```
   fields @timestamp, kubernetes.container_name as service
   | filter log like / ERROR /
   | stats count(*) as errors by bin(5m), service
   ```

4. For each metric widget, enter the **Title** from the table, then pick the metrics under **Metrics** and set the **Statistic** and **Period** from the table. For the Valkey widget, add the math expression `MAX([a,b])` as in step 4.3 and clear the check boxes of the two source rows.
5. For **Alarm status**, set **Title** to `Alarm status`, then tick every `ridenow-prod-` alarm you created.
6. Drag and resize each widget to the `y` row and width in the table. Choose **Save**.

A faster way once one widget exists: choose **Actions -> View/edit source** and paste a JSON body with the same layout, as in `DashboardBody` in the template. The source view also shows the grid positions (`x`, `y`, `width`, `height`) used above.

**Where to edit a widget.** Open **CloudWatch -> Dashboards -> `ridenow-prod`**. Hover over the widget and choose the three-dot menu (**Widget actions**) -> **Edit** to change its metrics, statistic, period or title. Choose **Save** at the top when you are done. Use **Actions -> View/edit source** to edit the whole page as JSON. If you add an alarm later, add it to the **Alarm status** widget the same way, or it will not show there.

### 6. Saved queries (`TraceIdQuery`, `ErrorsByServiceQuery`)

Both queries run on the pod log group `/aws/eks/ridenow-prod/fargate`.

**What the queries rely on.** The seven services write **plain-text** log lines, not JSON, in the form `... logger : trace_id=<id> span_id=<id> message`. The log router stores each line as one event and adds Kubernetes fields. The queries use only these names:

| Name | What it is |
|---|---|
| `log` | The raw log line. The queries filter on it with `like`. |
| `kubernetes.container_name` | Added by the router's Kubernetes filter. It equals the service name, for example `trip-service`. |
| `trace_id=` | A text token inside `log`, not a field. The trace query matches the string `trace_id=<id>`. |

Because the lines are plain text, the field names `trace_id` and `level` do not exist in Logs Insights. Do not write `filter trace_id = ...`. The level sits right after the timestamp, for example `... ERROR 1 --- ... : trace_id=...`, so `like / ERROR /` matches the level token.

**Saved query 1: by trace id.**

1. Go to **CloudWatch -> Logs -> Logs Insights**.
2. Under **Select log group(s)**, pick `/aws/eks/ridenow-prod/fargate`.
3. Replace the query box with the text below.

   ```
   fields @timestamp, kubernetes.container_name as service, log
   | filter log like "trace_id=1-REPLACE-ME"
   | sort @timestamp asc
   ```

4. Choose **Save**. Set **Query name** to `ridenow-prod/by-trace-id`. Choose **Save**.

When you use it, replace `1-REPLACE-ME` with the Trace_Id from the `X-Trace-Id` response header (`09-xray-tracing.md`), for example `1-67a1b2c3-0123456789abcdef01234567`. The query keeps this placeholder on purpose.

**Saved query 2: errors by service.**

1. In **Logs Insights**, keep the log group `/aws/eks/ridenow-prod/fargate`.
2. Replace the query box with the text below.

   ```
   fields @timestamp, kubernetes.container_name as service
   | filter log like / ERROR /
   | stats count(*) as errors by service, bin(5m)
   ```

3. Choose **Save**. Set **Query name** to `ridenow-prod/errors-by-service`. Choose **Save**.

To count the errors of the last hour, set the time range at the top to `1h` before you choose **Run query**.

**If `service` is empty.** `kubernetes.container_name` comes from the router's Kubernetes filter, and it is missing if the first events were written before the filter worked. Run the query once in Post-Deploy. If the column is empty, take the service from the log stream name instead. Replace the first line of the query with:

```
fields @timestamp, @logStream, log
```

and add `| parse @logStream "kube.var.log.containers.*_ridenow_" as pod` after it. `pod` then holds the pod name, which starts with the service name. Group by `pod` instead of `service`.

Saved queries are stored per region and are listed under **Logs Insights -> Queries** in the folder `ridenow-prod`.

## Values to record

Read these in the console and keep them. The topic ARN is used by Post-Deploy and Verify, and the names are used when you look for the resources later.

| Output_Equivalent (Template output) | Value | Console location | Consumed by |
|---|---|---|---|
| `AlarmTopicArn` | `arn:aws:sns:ap-southeast-1:ACCOUNT_ID:ridenow-prod-alarms` | **Amazon SNS -> Topics** -> `ridenow-prod-alarms`, **Details -> ARN** | Post-Deploy step 3 and Verify step 4 |
| `PodLogGroupName` | `/aws/eks/ridenow-prod/fargate` | **CloudWatch -> Logs -> Log management**, **Log group** column | Post-Deploy steps 1 and 4 and Verify step 1 |
| `DashboardName` | `ridenow-prod` | **CloudWatch -> Dashboards**, **Name** column | Verify step 3 |

## Post-Deploy

Run these steps from the repo root in WSL, in order. The cluster, the services and the `kubectl` context come from `06-eks-cluster.md` and `07-eks-addons.md`. Set the variables once:

```bash
export AWS_REGION=ap-southeast-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export TOPIC_ARN="arn:aws:sns:${AWS_REGION}:${ACCOUNT_ID}:ridenow-prod-alarms"
echo "$TOPIC_ARN"
```

Expected: one line `arn:aws:sns:ap-southeast-1:<your account id>:ridenow-prod-alarms`.

### 1. Fargate log router (apply `iac/k8s/01-aws-logging.yaml`)

This is the **log router step** that `06-eks-cluster.md` step 7 points to: it is **step 1 of this Post-Deploy section**. Do it after the log group `/aws/eks/ridenow-prod/fargate` exists (Create the resources, step 1) and after the pod execution role has the inline policy `fargate-log-router-logs` (`01-iam.md`).

The manifest creates the namespace `aws-observability` (label `aws-observability: enabled`) and the ConfigMap `aws-logging`. The router reads the ConfigMap only when a pod starts, so pods that are already running need a restart (step 2).

```bash
kubectl apply -f iac/k8s/01-aws-logging.yaml
kubectl get configmap aws-logging -n aws-observability
kubectl get namespace aws-observability --show-labels
```

Expected: `namespace/aws-observability created` and `configmap/aws-logging created` (or `unchanged` on a repeat). `kubectl get configmap` lists `aws-logging` with `DATA` `2`. The namespace shows `Active` and the label `aws-observability=enabled`.

### 2. Restart the services

Restart every deployment in `ridenow` so each new pod starts with the log router active. Each restart replaces the pods one by one, so the services stay available.

```bash
kubectl rollout restart deploy -n ridenow
kubectl get deploy -n ridenow -o name | xargs -n1 kubectl rollout status -n ridenow --timeout=600s
```

Expected: `deployment.apps/<name> restarted` for each deployment, then `deployment "<name>" successfully rolled out` for each. Fargate starts a new microVM per pod, so this takes a few minutes. Then check that the log streams exist:

```bash
aws logs describe-log-streams --log-group-name /aws/eks/ridenow-prod/fargate \
  --order-by LastEventTime --descending --max-items 5 \
  --query 'logStreams[].logStreamName' --output text
```

Expected: stream names that start with `fargate-kube.var.log.containers.` and contain the service names, for example `trip-service`. An empty result after 3 minutes means the router cannot write: check the inline policy with `aws iam get-role-policy --role-name ridenow-prod-eks-fargate-pod-execution-role --policy-name fargate-log-router-logs` and read **Create the resources** step 1.

### 3. Confirm the SNS subscription

Skip this step if `ALARM_EMAIL` was empty.

1. Open the mail from `AWS Notifications` with the subject `AWS Notification - Subscription Confirmation`. Check the spam folder if it is missing.
2. Choose **Confirm subscription**. The browser shows `Subscription confirmed!`.

```bash
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].[Protocol,Endpoint,SubscriptionArn]' --output text
```

Expected: one row `email  <your address>  arn:aws:sns:...:ridenow-prod-alarms:<uuid>`. The value `PendingConfirmation` in the last column means the mail is not confirmed yet. Verify step 4 checks the status again.

### 4. Find the logs of one request by trace id

The services return the X-Ray trace id in the `X-Trace-Id` response header, and write the same id in every log line as `trace_id=<id>` (`09-xray-tracing.md`). Send one booking and read the header:

```bash
ALB_DNS=$(kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
BASE="http://$ALB_DNS"
RUN=$(date +%s)
RIDER_ID=$(curl -s -X POST "$BASE/api/users" -H 'Content-Type: application/json' \
  -d "{\"cognitoSub\":\"logs-$RUN\",\"email\":\"logs.$RUN@test.com\",\"fullName\":\"Logs $RUN\"}" | jq -r .id)
curl -s -D - -o /dev/null -X POST "$BASE/api/trips" -H 'Content-Type: application/json' \
  -d "{\"passengerId\":\"$RIDER_ID\",\"rideType\":\"CAR\",\"pickupLat\":10.7769,\"pickupLng\":106.7009,\"destinationLat\":10.8231,\"destinationLng\":106.6297,\"paymentMethod\":\"SIMULATED_CARD\"}" \
  | grep -iE '^(HTTP|x-trace-id)'
```

Expected: `HTTP/1.1 201` and a line like `x-trace-id: 1-6650a1b2-3c4d5e6f7a8b9c0d1e2f3a4b`. Copy the value after `x-trace-id:`. A `503` on the first trip after a deploy is the payment cold start; send the request again.

Then, in the console:

1. Go to **CloudWatch -> Logs -> Logs Insights -> Queries** (the **Saved queries** tab) and open the folder `ridenow-prod`. Choose `ridenow-prod/by-trace-id` and **Apply** (or **Load**). The log group `/aws/eks/ridenow-prod/fargate` is selected.
2. In the query, replace `1-REPLACE-ME` with your trace id.
3. Set the time range to **Last 30 minutes** and choose **Run query**. Logs arrive in CloudWatch within about a minute, so wait a minute and run it again if the result is empty.

Expected: sorted lines, all with the same `trace_id=` value, from these services (this follows the call path in the code):

- `trip-service`: always. It handles the request and logs `Published event type=trip.requested ...` after the trip is saved.
- `matching-service`: normally. It reads `trip.requested` from its queue and continues the same trace (`09-xray-tracing.md`), so its lines show up once it handles the event and publishes its own, for example `Published event type=...`. They can arrive a few seconds after the request, so run the query again if they are missing.
- `payment-service`: not guaranteed. `trip-service` calls it synchronously and the trace includes that call in X-Ray, but a successful authorization writes no INFO line in `payment-service` and publishes no event. Its lines appear only for warnings and errors.
- `notification-worker`: not guaranteed. It logs at INFO only in cases such as an event with no recipient.

A result with only `trip-service` lines is normal. Use the X-Ray trace (`09-xray-tracing.md`) to see the `payment-service` and queue hops. If the `service` column is empty, use the fallback in **Create the resources**, step 6.

### 5. Test an alarm: the DLQ path

This checks the whole chain: alarm, SNS topic, email. It sends one harmless message to the dead-letter queue of notifications, waits for the alarm and purges the queue afterwards. Do it while no real message is in that DLQ.

```bash
DLQ_URL=$(aws sqs get-queue-url --queue-name ridenow-prod-notifications-dlq --query QueueUrl --output text)
aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages --query 'Attributes' --output json
```

Expected: `"ApproximateNumberOfMessages": "0"`. If it is not `0`, stop: a real message is waiting and the alarm is already, or about to be, in ALARM. Read it first (`aws sqs receive-message --queue-url "$DLQ_URL"`) and do not purge it.

Send the test message:

```bash
aws sqs send-message --queue-url "$DLQ_URL" --message-body '{"test":"cloudwatch-guide alarm test"}'
```

Expected: JSON with a `MessageId` and `MD5OfMessageBody`.

Wait 2 to 4 minutes, then read the alarm state:

```bash
aws cloudwatch describe-alarms --alarm-names ridenow-prod-notifications-dlq-depth \
  --query 'MetricAlarms[0].StateValue' --output text
```

Expected: `ALARM`. It stays `OK` or `INSUFFICIENT_DATA` for the first minutes, so repeat the command every minute. The alarm uses a 60-second period with one datapoint, and the SQS metric is published with a delay of a minute or two. Within about 5 minutes you also receive the mail `ALARM: "ridenow-prod-notifications-dlq-depth" in Asia Pacific (Singapore)` at your `ALARM_EMAIL` address (skip this part if it was empty). The dashboard widget **Alarm status** shows the alarm in red.

Purge the DLQ afterwards, so the alarm returns to `OK` and the queue is clean:

```bash
aws sqs purge-queue --queue-url "$DLQ_URL"
sleep 120
aws cloudwatch describe-alarms --alarm-names ridenow-prod-notifications-dlq-depth \
  --query 'MetricAlarms[0].StateValue' --output text
```

Expected: `purge-queue` prints nothing. After a few minutes the state is `OK`, and a second mail `OK: "ridenow-prod-notifications-dlq-depth" ...` arrives. SQS allows one purge per queue every 60 seconds, and the purge can take up to 60 seconds. If the state is still `ALARM`, wait and run the last command again.

### 6. Find failed logins in the control-plane logs

The EKS authenticator log records each request that the API server rejects because the IAM identity is not mapped. Run a failed-authentication query on the control-plane log group `/aws/eks/ridenow-prod/cluster`:

1. Go to **CloudWatch -> Logs -> Logs Insights**.
2. Under **Select log group(s)**, pick `/aws/eks/ridenow-prod/cluster`.
3. Set the time range to **Last 24 hours**, paste the query below and choose **Run query**.

```
fields @timestamp, @logStream, @message
| filter @logStream like /authenticator/
| filter @message like /(?i)(access denied|not authorized|unauthorized|invalid|could not|failed)/
| sort @timestamp desc
| limit 50
```

Expected: no rows on a healthy cluster, or a few rows with `level=warning` and a message such as `access denied`, one per rejected sign-in, with the stream name starting with `authenticator-`. If the result is empty and you want to see the query work, run `kubectl get ns` with an IAM identity that is not mapped in the cluster (or after `aws sts get-caller-identity` shows a different role), wait one to two minutes and run the query again. A query that returns no rows at all in **every** control-plane stream (try removing the second `filter` line) means the five log types are not on: check **EKS -> Clusters** -> `ridenow-prod` -> **Observability** tab -> **Control plane logging**.

## Verify

Run these in WSL. Each result is the condition for the step to be good.

### 1. Log groups

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/eks/ridenow-prod/ \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output text
```

Expected: two rows, `/aws/eks/ridenow-prod/cluster  14` and `/aws/eks/ridenow-prod/fargate  14`. A `None` instead of `14` means the retention is not set: **Actions -> Edit retention setting(s)** in the console.

### 2. Alarms

```bash
aws cloudwatch describe-alarms --alarm-name-prefix ridenow-prod- \
  --query 'length(MetricAlarms)' --output text
aws cloudwatch describe-alarms --alarm-name-prefix ridenow-prod-alb- \
  --query 'length(MetricAlarms)' --output text
aws cloudwatch describe-alarms --alarm-name-prefix ridenow-prod- \
  --query "MetricAlarms[?AlarmActions[0]!='$TOPIC_ARN'].AlarmName" --output text
```

Expected: `21` (3 DLQ, 3 queue age, 1 SNS, 12 database, 1 Valkey and 1 ALB), then `1` for the ALB alarm, then an empty line: every alarm sends to `ridenow-prod-alarms`. The count is `20` and the second number `0` if you left the ALB alarm for later. The states are `OK` or `INSUFFICIENT_DATA` right after creation, not `ALARM`; check with `aws cloudwatch describe-alarms --alarm-name-prefix ridenow-prod- --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text`, which should print nothing.

### 3. Dashboard

```bash
aws cloudwatch get-dashboard --dashboard-name ridenow-prod \
  --query 'DashboardName' --output text
aws cloudwatch get-dashboard --dashboard-name ridenow-prod \
  --query 'DashboardBody' --output text | jq '.widgets | length'
```

Expected: `ridenow-prod`, then `7` with every switch on (1 alarm status, 2 messaging, 1 RDS CPU, 1 Valkey memory, 1 ALB 5xx and 1 error widget). The number is lower by 2, 1 or 1 for each part that is off. An error `ResourceNotFound` means the dashboard name is wrong.

### 4. Subscription

```bash
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].SubscriptionArn' --output text
aws sns get-subscription-attributes \
  --subscription-arn "$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query 'Subscriptions[0].SubscriptionArn' --output text)" \
  --query 'Attributes.[PendingConfirmation,Protocol,Endpoint]' --output text
```

Expected: one ARN ending in `:ridenow-prod-alarms:<uuid>`, then `false  email  <your address>`. `PendingConfirmation` `false` means the status is **Confirmed**. In the console, **Amazon SNS -> Subscriptions** shows **Status** `Confirmed`. Skip this step if `ALARM_EMAIL` was empty: the first command then prints nothing.

## Cost note

Nothing in this guide is free except what the CloudWatch free tier covers. Check the current prices on the [CloudWatch pricing page](https://aws.amazon.com/cloudwatch/pricing/) before you leave the resources running, because prices change and differ by region. Each item below is what you pay for, not an amount.

| Item | What is billed | In this guide |
|---|---|---|
| Log ingestion | Per GB of log data sent to CloudWatch Logs | All seven services write to `/aws/eks/ridenow-prod/fargate`. A chatty service raises this most. The EKS audit log in `/aws/eks/ridenow-prod/cluster` is often the largest of the control-plane streams. |
| Log storage | Per GB per month of stored data | Stops growing when the retention period starts to delete old data: both groups use `LogRetentionDays` (14 days). Without retention, storage would grow for ever. |
| Logs Insights queries | Per GB of data scanned | Each run of a query, and each time the dashboard loads the **ERROR count per service** widget, scans the pod log group. Keep the time range short. |
| Dashboards | Per dashboard per month, beyond the free three, prorated by the hour | One dashboard (`ridenow-prod`) fits in the free three. A fourth dashboard in the account is billed. |
| Alarms | Per alarm metric per month, beyond the free ten, prorated by the hour | See below. |
| Alarm topic | SNS requests and email deliveries | Negligible at alarm volumes. |

**Alarm count, with metric math.** A metric alarm is billed for each metric in its expression, up to ten with metric math, not once per alarm. The 21 alarms hold 22 alarm metrics: 20 alarms with one metric each, plus the Valkey alarm (`MAX` of two nodes) with two. So 12 alarm metrics are billable after the free ten.

**Retention stops storage growth.** Retention does not lower the ingestion cost. It only caps how long data is stored, so storage cost stops growing after `LogRetentionDays` and stays near ingestion rate times 14 days. To keep less, lower `LogRetentionDays` in `iac/params/prod.json` (stack 06 for the cluster group, stack 09 for the pod group) or edit the retention of each group in the console.

## Teardown

Delete the resources of this guide before the resources they watch. The steps match rows **A1** to **A4** and **10a** of the Teardown table in [README.md](./README.md). The order matters in two places: alarms before the topic they notify, and the control-plane log group after the cluster.

| README row | Resource | How |
|---|---|---|
| A1 | Dashboard `ridenow-prod` | **CloudWatch -> Dashboards** -> tick `ridenow-prod` -> **Delete dashboard**. |
| A2 | The 21 alarms `ridenow-prod-*` | **CloudWatch -> Alarms -> All alarms**, search `ridenow-prod-`, select all, **Actions -> Delete**. Delete them before the topic. |
| A3 | The email subscription and the topic `ridenow-prod-alarms` | **Amazon SNS -> Subscriptions**, delete the subscription. Then **Topics** -> `ridenow-prod-alarms` -> **Delete**. |
| A4 | Saved queries `ridenow-prod/by-trace-id` and `ridenow-prod/errors-by-service`, then the pod log group `/aws/eks/ridenow-prod/fargate` | **CloudWatch -> Logs Insights -> Queries**, open each in the `ridenow-prod` folder, **Actions -> Delete**. Then **CloudWatch -> Logs -> Log management**, tick the group, **Actions -> Delete log group(s)**. The router stops writing once the group is gone, and deleting it stops the pod log storage cost. |
| 10a | Control-plane log group `/aws/eks/ridenow-prod/cluster` | Same place as A4, after the cluster is deleted (README step 10). Deleted earlier, EKS creates it again with no retention while logging is on. |

Check that nothing is left:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix ridenow-prod- --query 'length(MetricAlarms)' --output text
aws cloudwatch list-dashboards --dashboard-name-prefix ridenow-prod --query 'length(DashboardEntries)' --output text
aws logs describe-log-groups --log-group-name-prefix /aws/eks/ridenow-prod/ --query 'length(logGroups)' --output text
```

Expected: `0`, `0`, `0`.

With the CloudFormation stacks (`iac/scripts/teardown.sh`) the order is built in: stack `09-observability` is deleted first and removes the pod log group, all alarms, the dashboard, the topic and the saved queries. The control-plane log group is deleted with stack `06-eks-cluster`.
