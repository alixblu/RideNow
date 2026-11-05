# 07 - Deploy workloads + ALB (manual)

Goal: run the six services on the cluster and expose the four HTTP ones through
an ALB. Same as `../aws/06-eks-deploy.md` - the difference is you pull the DB
endpoints and secret ARNs from the CloudFormation **exports**.

---

## 1. ALB Load Balancer Controller

Identical to `../aws/06-eks-deploy.md` section 1 (create the IRSA role, Helm
install). For the Helm `--set vpcId=...`, use the CFN VPC export:

```bash
VPC_ID=$(aws cloudformation list-exports --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-network-VpcId'].Value" --output text)
echo "$VPC_ID"   # pass this as vpcId
```

## 2. Namespace + DB Secrets

```bash
kubectl apply -f iac/k8s/00-namespace.yaml
```

Two ways to get DB credentials into the cluster:

- **External Secrets (matches the committed manifest).** `iac/k8s/10-external-secrets.yaml`
  pulls each `ridenow-<ENV>-<svc>-db` secret from Secrets Manager. The CFN
  `04-data` stack created those master secrets; confirm their names/ARNs:
  ```bash
  aws cloudformation list-exports --region ap-southeast-1 \
    --query "Exports[?ends_with(Name,'DbSecretArn')].[Name,Value]" --output table
  ```
  Install the External Secrets Operator, give its service account an IRSA role
  that can read those ARNs, set `<ENV>`/`<REGION>` in the manifest, and apply it.
  (It already includes matching + notification entries.)

- **By hand (quick).** Read each secret's `username`/`password` from Secrets
  Manager and `kubectl create secret generic <svc>-db-credentials ...` - see
  `../aws/06-eks-deploy.md` section 2, Option A. Six secrets:
  user/driver/trip/payment/matching/notification.

## 3. Deploy the services

Fill the manifest placeholders from the CFN exports, then apply. Example for
trip-service:

```bash
TRIP_DB=$(aws cloudformation list-exports --region ap-southeast-1 \
  --query "Exports[?Name=='ridenow-dev-data-TripDbEndpoint'].Value" --output text)

sed -e 's/<ACCOUNT_ID>/123456789012/' \
    -e 's/<REGION>/ap-southeast-1/' \
    -e 's/<IMAGE_TAG>/local/' \
    -e "s/<TRIP_DB_ENDPOINT>/$TRIP_DB/" \
    iac/k8s/22-trip-service.yaml | kubectl apply -f -
```

Apply all six (the manifests already exist for every service):

```
iac/k8s/20-user-service.yaml          <USER_DB_ENDPOINT>
iac/k8s/21-driver-service.yaml        <DRIVER_DB_ENDPOINT>  (+ Redis later)
iac/k8s/22-trip-service.yaml          <TRIP_DB_ENDPOINT>
iac/k8s/23-payment-service.yaml       <PAYMENT_DB_ENDPOINT>
iac/k8s/24-matching-service.yaml      <MATCHING_DB_ENDPOINT> <REDIS_ENDPOINT> (Redis from step 08)
iac/k8s/25-notification-worker.yaml   <NOTIFICATION_DB_ENDPOINT> <NOTIFICATIONS_QUEUE_URL> <...ROLE_ARN> (from step 09)
```

The matching/notification DB endpoints come from the **manual** RDS instances you
made in step 01-04 (not a CFN export) - read them from the RDS console. The Redis
endpoint, queue URL, and worker role ARN come from steps 08 and 09; until then,
matching can't answer GEO queries and the worker idles (both start healthy).

```bash
kubectl get pods -n ridenow -w
```

## 4. Ingress + verify

```bash
kubectl apply -f iac/k8s/30-ingress.yaml
ADDR=$(kubectl get ingress ridenow -n ridenow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -s "http://$ADDR/api/drivers"
```

A JSON response through the ALB = the backend is running on EKS, connected to the
CloudFormation-provisioned RDS. Done.

## Clean up

Delete the Ingress (removes the ALB) and workloads, then the cluster/node group,
**before** `teardown.sh dev --apply` can remove the network stack.

Next (optional): `08-later-elasticache-redis.md`, `09-later-sqs-eventbridge.md`.
