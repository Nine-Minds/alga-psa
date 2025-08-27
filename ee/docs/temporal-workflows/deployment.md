# Temporal Worker Deployment Guide

This guide provides instructions for deploying the temporal worker to production using the Argo workflows and Helm charts created for the alga-psa project.

## Prerequisites

Before deploying the temporal worker, ensure the following prerequisites are met:

1. **Vault Setup**
   - INTERNAL_API_SHARED_SECRET is stored in Vault at `secret/data/alga-psa/temporal-worker`
   - ALGA_AUTH_KEY is stored in Vault at `secret/data/alga-psa/shared`
   - Vault policy `temporal-worker` is created with read access to these paths
   - Service account is configured with appropriate Vault role

2. **Harbor Registry**
   - Harbor credentials are configured in the cluster
   - Access to push/pull from `harbor.nineminds.com/nineminds/temporal-worker`

3. **Database Access**
   - PostgreSQL cluster is accessible from the msp namespace
   - Database credentials are stored in the appropriate secrets

4. **Temporal Server**
   - Temporal server is running and accessible at `temporal-frontend.temporal.svc.cluster.local:7233`

## Building the Temporal Worker

### Manual Build

To manually trigger a build of the temporal worker:

```bash
# Submit the build workflow
kubectl create -n argo -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: temporal-worker-build-
spec:
  workflowTemplateRef:
    name: temporal-worker-build
  arguments:
    parameters:
    - name: repo-url
      value: "https://github.com/Nine-Minds/alga-psa.git"
    - name: commit-sha
      value: "main"  # or specific commit SHA
    - name: set-latest
      value: "true"  # Set to true to tag as latest
EOF
```

### Automated Build with Main Pipeline

The temporal worker is automatically built when using the composite workflow if changes are detected:

```bash
# Submit the composite workflow
kubectl create -n argo -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: alga-psa-full-deploy-
spec:
  workflowTemplateRef:
    name: alga-psa-build-migrate-deploy-with-temporal
  arguments:
    parameters:
    - name: repo-url
      value: "https://github.com/Nine-Minds/alga-psa.git"
    - name: commit-sha
      value: "main"
    - name: environment
      value: "hosted"
    - name: helm-values-file
      value: "hosted.values.yaml"
    - name: namespace
      value: "msp"
    - name: build-temporal-worker
      value: "auto"  # auto-detect changes, or "true" to always build
EOF
```

## Deploying the Temporal Worker

### Manual Deployment

To manually deploy the temporal worker with a specific image tag:

```bash
# Submit the deployment workflow
kubectl create -n argo -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: temporal-worker-deploy-
spec:
  workflowTemplateRef:
    name: temporal-worker-deploy
  arguments:
    parameters:
    - name: image-tag
      value: "abc12345"  # Use the short SHA from build
    - name: environment
      value: "production"
    - name: namespace
      value: "msp"
    - name: helm-values-file
      value: "hosted.values.yaml"
    - name: rollback-on-failure
      value: "true"
EOF
```

### Verifying Deployment

After deployment, verify the temporal worker is running:

```bash
# Check deployment status
kubectl get deployment alga-psa-temporal-worker -n msp

# Check pods
kubectl get pods -n msp -l app.kubernetes.io/component=temporal-worker

# Check logs
kubectl logs -n msp -l app.kubernetes.io/component=temporal-worker --tail=100

# Check health endpoint
kubectl exec -n msp deployment/alga-psa-temporal-worker -- wget -q -O- http://localhost:8080/health
```

## Configuration

### Environment Variables

The temporal worker uses the following environment variables (injected via Vault or secrets):

- **TEMPORAL_ADDRESS**: Temporal server address
- **TEMPORAL_NAMESPACE**: Temporal namespace (default: "default")
- **TEMPORAL_TASK_QUEUE**: Task queue name (default: "tenant-workflows")
- **DB_HOST**, **DB_PORT**, **DB_NAME_SERVER**: Database connection
- **INTERNAL_API_SHARED_SECRET**: API authentication secret
- **ALGA_AUTH_KEY**: Encryption key for passwords
- **RESEND_API_KEY**: Email service API key
- **APPLICATION_URL**: Base URL for email links
- **NMSTORE_BASE_URL**: NM Store integration URL

### Scaling Configuration

The temporal worker is configured with:

- **Initial replicas**: 3 (production)
- **HPA**: Scales from 3 to 20 replicas based on CPU (70%) and memory (75%)
- **PDB**: Minimum 2 available pods during disruptions

To manually scale:

```bash
kubectl scale deployment alga-psa-temporal-worker -n msp --replicas=5
```

## Troubleshooting

### Common Issues

1. **Worker fails to start**
   - Check Vault secret injection: `kubectl describe pod <pod-name> -n msp`
   - Verify secrets are mounted: `kubectl exec -n msp <pod-name> -- ls /vault/secrets/`

2. **Database connection errors**
   - Verify database is accessible: `kubectl exec -n msp <pod-name> -- nc -zv <db-host> 5432`
   - Check database credentials in secrets

3. **Temporal connection errors**
   - Verify Temporal server is running: `kubectl get pods -n temporal`
   - Check network connectivity to Temporal

4. **Health check failures**
   - Check worker logs for startup errors
   - Verify port 8080 is accessible within the pod

### Rollback Procedure

If deployment fails, the workflow automatically rolls back. To manually rollback:

```bash
# List Helm releases
helm history alga-psa -n msp

# Rollback to previous version
helm rollback alga-psa <revision-number> -n msp
```

## Monitoring

### Logs

Temporal worker logs are collected by the cluster logging solution. Key log patterns to monitor:

- `"level":"error"` - Error conditions
- `"workflow":"started"` - Workflow executions
- `"activity":"completed"` - Activity completions
- `"health":"check"` - Health check status

### Metrics

The temporal worker exposes metrics that can be scraped by Prometheus:

- Worker task queue depth
- Workflow execution duration
- Activity execution duration
- Error rates

### Alerts

Recommended alerts:

1. **Worker Pod Down**: Less than minimum replicas running
2. **High Error Rate**: More than 5% of workflows failing
3. **Task Queue Backup**: More than 100 pending tasks
4. **Memory Pressure**: Worker using >80% of memory limit

## Security Considerations

1. **Secret Rotation**
   - INTERNAL_API_SHARED_SECRET should be rotated quarterly
   - Update in Vault and restart workers

2. **Network Policies**
   - Worker should only connect to:
     - PostgreSQL database
     - Temporal server
     - Redis (if caching enabled)
     - External APIs (Resend, NM Store)

3. **RBAC**
   - Service account has minimal permissions
   - No cluster-wide access required

## Maintenance

### Updating the Worker

To update the temporal worker code:

1. Make changes in `ee/temporal-workflows/`
2. Commit and push to repository
3. Run the build workflow with new commit SHA
4. Deploy using the deployment workflow

### Database Migrations

Database migrations are handled by the main alga-psa migration workflow. The temporal worker uses the same database schema.

### Performance Tuning

Adjust these values based on workload:

```yaml
temporalWorker:
  temporal:
    maxConcurrentActivityExecutions: 20  # Increase for more parallelism
    maxConcurrentWorkflowTaskExecutions: 20
  resources:
    requests:
      cpu: 1000m  # Increase for CPU-intensive workflows
      memory: 2Gi  # Increase for memory-intensive workflows
```