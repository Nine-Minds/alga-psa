# Temporal Worker - Remaining Deployment Tasks

This document outlines the remaining tasks needed to complete the temporal worker deployment to production.

## Phase 1: Infrastructure Preparation and Secret Setup (Partial)

### Vault Secrets Creation
These secrets need to be created in Vault before deployment:

1. **INTERNAL_API_SHARED_SECRET**
   ```bash
   # Generate a secure 32+ character secret
   openssl rand -base64 32
   
   # Store in Vault
   vault kv put secret/alga-psa/temporal-worker \
     internal_api_shared_secret="<generated-secret>"
   ```

2. **ALGA_AUTH_KEY** 
   ```bash
   # Verify this exists in shared secrets
   vault kv get secret/alga-psa/shared
   
   # If not present, generate and store
   openssl rand -base64 32
   vault kv put secret/alga-psa/shared \
     alga_auth_key="<generated-secret>"
   ```

### Vault Policy Creation
Create the temporal-worker policy:

```hcl
# temporal-worker-policy.hcl
path "secret/data/alga-psa/temporal-worker" {
  capabilities = ["read"]
}

path "secret/data/alga-psa/shared" {
  capabilities = ["read"]
}

# Apply the policy
vault policy write temporal-worker temporal-worker-policy.hcl
```

### Kubernetes Service Account Configuration
```bash
# The service account is created by Helm, but needs Vault annotation
kubectl annotate serviceaccount alga-psa-temporal-worker \
  -n msp \
  vault.hashicorp.com/role=temporal-worker
```

## Phase 3: Build and Registry Setup (Final Step)

### Initial Image Build
Before first deployment, build and push the temporal worker image:

```bash
# Submit the build workflow
kubectl create -n argo -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: temporal-worker-initial-build-
spec:
  workflowTemplateRef:
    name: temporal-worker-build
  arguments:
    parameters:
    - name: repo-url
      value: "https://github.com/Nine-Minds/alga-psa.git"
    - name: commit-sha
      value: "$(git rev-parse HEAD)"
    - name: set-latest
      value: "true"
EOF

# Monitor the build
kubectl logs -n argo -l workflows.argoproj.io/workflow=temporal-worker-initial-build-xxxxx -f

# Verify image in Harbor
# Check harbor.nineminds.com/nineminds/temporal-worker:latest exists
```

## Phase 5: Database and Network Configuration

### Verify Connectivity
These checks should be performed from a test pod in the msp namespace:

```bash
# Create a test pod
kubectl run -n msp test-connectivity --image=busybox --rm -it -- sh

# Inside the pod:
# Test database connectivity
nc -zv pgvector.stackgres-pgvector.svc.cluster.local 5432

# Test Temporal connectivity  
nc -zv temporal-frontend.temporal.svc.cluster.local 7233

# Test Redis (if needed)
nc -zv redis.msp.svc.cluster.local 6379
```

## Phase 6: Deployment and Validation

### Staging Deployment
1. First deploy to a staging namespace if available
2. Run the composite workflow with staging parameters
3. Verify all components are working

### Production Deployment Checklist
- [ ] All Vault secrets are created and accessible
- [ ] Initial Docker image is built and pushed
- [ ] Database connectivity is verified
- [ ] Temporal server is accessible
- [ ] Harbor credentials are configured

### Deployment Command
```bash
# Deploy using the composite workflow
kubectl create -n argo -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: alga-psa-deploy-with-temporal-
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
      value: "true"  # Force temporal worker deployment
EOF
```

## Phase 7: Monitoring and Observability

### Prometheus Scraping Configuration
Add temporal worker metrics to Prometheus:

```yaml
# prometheus-config.yaml
- job_name: 'temporal-worker'
  kubernetes_sd_configs:
  - role: pod
    namespaces:
      names:
      - msp
  relabel_configs:
  - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_component]
    action: keep
    regex: temporal-worker
  - source_labels: [__meta_kubernetes_pod_name]
    target_label: instance
  - target_label: __address__
    replacement: ${1}:8080
    source_labels: [__meta_kubernetes_pod_ip]
```

### Grafana Dashboard
Import or create a dashboard with:
- Worker pod count and status
- CPU and memory usage
- Workflow execution rate
- Activity execution duration
- Error rates

### Alerting Rules
```yaml
# temporal-worker-alerts.yaml
groups:
- name: temporal-worker
  rules:
  - alert: TemporalWorkerDown
    expr: up{job="temporal-worker"} == 0
    for: 5m
    annotations:
      summary: "Temporal worker is down"
      
  - alert: TemporalWorkerHighErrorRate
    expr: rate(temporal_workflow_failed_total[5m]) > 0.05
    for: 10m
    annotations:
      summary: "High temporal workflow error rate"
      
  - alert: TemporalWorkerMemoryHigh
    expr: container_memory_usage_bytes{pod=~"alga-psa-temporal-worker.*"} / container_spec_memory_limit_bytes > 0.8
    for: 5m
    annotations:
      summary: "Temporal worker memory usage is high"
```

## Post-Deployment Verification

After successful deployment:

1. **Check Logs**
   ```bash
   kubectl logs -n msp -l app.kubernetes.io/component=temporal-worker --tail=100
   ```

2. **Verify Workflows**
   - Test tenant provisioning workflow
   - Test email sending
   - Test checkout session handling

3. **Monitor Metrics**
   - CPU and memory usage should stabilize
   - No error logs should appear
   - Health checks should pass consistently

## Rollback Plan

If issues occur:

1. **Automatic Rollback**: The deployment workflow includes automatic rollback on health check failure

2. **Manual Rollback**:
   ```bash
   helm rollback alga-psa -n msp
   ```

3. **Disable Temporal Worker**:
   ```bash
   helm upgrade alga-psa ./helm \
     -n msp \
     -f hosted.values.yaml \
     --set temporalWorker.enabled=false
   ```