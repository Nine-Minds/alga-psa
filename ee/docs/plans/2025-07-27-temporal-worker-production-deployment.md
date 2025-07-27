# Temporal Worker Stack Production Deployment Plan

## Intro / Rationale

This plan outlines the deployment of the temporal worker service to the alga-psa hosted production environment. The temporal worker is a critical component that handles asynchronous workflows including tenant provisioning, user management, email notifications, and checkout session processing. 

The deployment requires:
- Integration with existing alga-psa infrastructure (database, secrets, vault)
- Proper scaling configuration for production workloads
- Secure API key management through Vault agent injection
- Alignment with existing deployment patterns using Argo workflows

**Success Criteria:**
- Temporal worker running as a scalable service in production
- All required secrets properly injected from Vault
- Health checks and monitoring in place
- Successful integration with existing alga-psa services
- Zero downtime deployment capability

**Key Stakeholders:**
- DevOps team (deployment and infrastructure)
- Backend team (temporal workflow functionality)
- Security team (secrets management)

## Phased Implementation Checklist

### Phase 1: Infrastructure Preparation and Secret Setup
- [ ] Create Vault secret for INTERNAL_API_SHARED_SECRET
  - [ ] Generate secure random API key (minimum 32 characters)
  - [ ] Store in Vault at path: `secret/data/alga-psa/temporal-worker`
  - [ ] Include key: `internal_api_shared_secret`
- [ ] Ensure ALGA_AUTH_KEY exists in shared secrets
  - [ ] Verify key exists at: `secret/data/alga-psa/shared`
  - [ ] Include key: `alga_auth_key`
- [ ] Create Vault policy for temporal-worker service account
  - [ ] Grant read access to `secret/data/alga-psa/temporal-worker/*`
  - [ ] Grant read access to existing alga-psa secrets path
- [ ] Configure Kubernetes service account for temporal-worker
  - [ ] Create service account in target namespace (likely `msp` or dedicated `temporal` namespace)
  - [ ] Bind Vault policy to service account
- [ ] Verify Vault agent injector is installed and configured in cluster
  - [ ] Check vault-agent-injector deployment status
  - [ ] Verify webhook configuration

### Phase 2: Helm Chart Development
- [x] Create temporal-worker Helm templates
  - [x] Copy and adapt deployment template from main alga-psa deployment
  - [x] Create `helm/templates/temporal-worker/deployment.yaml`
  - [x] Create `helm/templates/temporal-worker/service.yaml`
  - [x] Create `helm/templates/temporal-worker/configmap.yaml`
  - [x] Create `helm/templates/temporal-worker/hpa.yaml` for autoscaling
  - [x] Create `helm/templates/temporal-worker/pdb.yaml` for pod disruption budget
  - [x] Create `helm/templates/temporal-worker/serviceaccount.yaml`
  - [x] Create `helm/templates/temporal-worker/secrets.yaml` for local development
- [x] Add temporal-worker configuration to values files
  - [x] Update `helm/values.yaml` with default temporal worker settings
  - [x] Update `nm-kube-config/alga-psa/hosted.values.yaml` with production overrides
- [x] Configure Vault agent injection annotations
  - [x] Add vault.hashicorp.com/agent-inject annotations
  - [x] Configure secret paths for all required secrets
  - [x] Set up secret templates for environment variable format
- [x] Add temporal worker image configuration
  - [x] Configure image repository path
  - [x] Set up image pull secrets if using private registry

### Phase 3: Build and Registry Setup
- [x] Create temporal-worker build workflow in Argo
  - [x] Create `workflows/build/temporal-worker-build-workflow.yaml`
  - [x] Follow buildx pattern from `alga-psa-ci-cd-workflow.yaml`
  - [x] Configure docker-in-docker sidecar with buildx
  - [x] Set up buildx builder with persistent cache
  - [x] Configure multi-platform builds (linux/amd64)
- [x] Configure Harbor registry authentication
  - [x] Use harbor-credentials secret
  - [x] Set up registry authentication in buildx
  - [x] Configure push to harbor.nineminds.com/nineminds/temporal-worker
- [x] Implement buildx cache strategy
  - [x] Create node-specific buildx cache PVC
  - [x] Configure cache-from and cache-to options
  - [x] Use local cache type for persistence
- [ ] Build and push initial temporal-worker image
  - [ ] Tag with git commit SHA
  - [ ] Push to Harbor registry
  - [ ] Verify image accessibility from cluster

### Phase 4: Argo Workflow Integration
- [x] Create temporal-worker deployment workflow
  - [x] Create `workflows/deploy/temporal-worker-deploy-workflow.yaml`
  - [x] Include steps for:
    - Cloning repositories
    - Updating image tags in values
    - Running Helm deployment
    - Health check verification
- [x] Update composite workflows
  - [x] Create `alga-psa-build-migrate-deploy-with-temporal.yaml` to include temporal-worker
  - [x] Add conditional deployment based on changes to ee/temporal-workflows
- [x] Create rollback workflow
  - [x] Implement automated rollback on deployment failure
  - [x] Include health check validation
- [ ] Test workflows in staging environment

### Phase 5: Database and Network Configuration
- [ ] Verify database connectivity in msp namespace
  - [ ] All services in msp namespace have network access by default
  - [ ] Confirm PostgreSQL cluster endpoint from alga-psa config
  - [ ] Verify connection strings match alga-psa pattern
- [ ] Configure Temporal server connectivity
  - [ ] Verify temporal-frontend service is accessible
  - [ ] Ensure correct namespace and ports
  - [ ] Test connection from within msp namespace
- [ ] Set up Redis access (if needed for caching)
  - [ ] Verify Redis service accessibility from msp namespace
  - [ ] Configure connection parameters

### Phase 6: Deployment and Validation
- [ ] Deploy to staging environment first
  - [ ] Run deployment workflow with staging parameters
  - [ ] Verify all pods start successfully
  - [ ] Check secret injection logs
  - [ ] Validate health endpoints
- [ ] Run integration tests
  - [ ] Test tenant provisioning workflow
  - [ ] Test email sending functionality
  - [ ] Verify checkout session handling
  - [ ] Check activity timeout handling
- [ ] Monitor resource usage
  - [ ] Observe CPU and memory consumption
  - [ ] Adjust resource requests/limits
  - [ ] Configure HPA thresholds
- [ ] Deploy to production
  - [ ] Execute production deployment workflow
  - [ ] Monitor deployment progress
  - [ ] Verify zero downtime
  - [ ] Check all health endpoints

### Phase 7: Monitoring and Observability
- [ ] Configure logging
  - [ ] Ensure logs are collected by cluster logging solution
  - [ ] Set appropriate log levels for production
  - [ ] Configure structured logging format
- [ ] Set up metrics collection
  - [ ] Export Temporal worker metrics
  - [ ] Configure Prometheus scraping
  - [ ] Create Grafana dashboards
- [ ] Configure alerting
  - [ ] Set up alerts for worker health
  - [ ] Configure alerts for workflow failures
  - [ ] Set up PagerDuty integration
- [ ] Document runbooks
  - [ ] Create troubleshooting guide
  - [ ] Document common issues and resolutions
  - [ ] Include rollback procedures

## Background Details / Investigation / Implementation Advice

### Vault Agent Injection Configuration

The Vault agent injector uses Kubernetes annotations to inject secrets. Here's the pattern for temporal-worker:

```yaml
metadata:
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "temporal-worker"
    vault.hashicorp.com/agent-inject-secret-internal-api: "secret/data/alga-psa/temporal-worker"
    vault.hashicorp.com/agent-inject-template-internal-api: |
      {{- with secret "secret/data/alga-psa/temporal-worker" -}}
      export INTERNAL_API_SHARED_SECRET="{{ .Data.data.internal_api_shared_secret }}"
      {{- end }}
    vault.hashicorp.com/agent-inject-secret-auth-key: "secret/data/alga-psa/shared"
    vault.hashicorp.com/agent-inject-template-auth-key: |
      {{- with secret "secret/data/alga-psa/shared" -}}
      export ALGA_AUTH_KEY="{{ .Data.data.alga_auth_key }}"
      {{- end }}
```

### Environment Variables Required

Based on the codebase analysis, the temporal-worker needs these environment variables:

**Core Temporal Configuration:**
- `TEMPORAL_ADDRESS`: temporal-frontend.temporal.svc.cluster.local:7233
- `TEMPORAL_NAMESPACE`: default
- `TEMPORAL_TASK_QUEUE`: tenant-workflows

**Database Configuration (matching alga-psa):**
- `DB_HOST`: From existing alga-psa configuration
- `DB_PORT`: 5432
- `DB_NAME_SERVER`: server
- `DB_USER_SERVER`: app_user
- `DB_PASSWORD_SERVER`: From existing secrets
- `DB_USER_ADMIN`: postgres
- `DB_PASSWORD_ADMIN`: From existing secrets

**Application Configuration:**
- `NODE_ENV`: production
- `LOG_LEVEL`: info
- `INTERNAL_API_SHARED_SECRET`: From Vault
- `RESEND_API_KEY`: From existing alga-psa secrets
- `APPLICATION_URL`: Production URL for email links
- `NMSTORE_BASE_URL`: For checkout session integration

**Encryption Configuration:**
- `ALGA_AUTH_KEY`: From Vault (required for password hashing)
- `SALT_BYTES`: 12 (or configured value)
- `ITERATIONS`: 10000 (or configured value)
- `KEY_LENGTH`: 64 (or configured value)
- `ALGORITHM`: sha512 (or configured value)

**Health Check Configuration:**
- `ENABLE_HEALTH_CHECK`: true
- `HEALTH_CHECK_PORT`: 8080

### Helm Template Structure

The temporal-worker should be deployed as a separate deployment within the alga-psa Helm chart. Key considerations:

1. **Namespace Strategy**: Deploy in the msp namespace alongside alga-psa services
2. **Service Account**: Use a dedicated service account for proper RBAC
3. **Resource Allocation**: Start with conservative limits and adjust based on monitoring
4. **Scaling**: Configure HPA with CPU and memory metrics
5. **Anti-affinity**: Spread pods across nodes for high availability
6. **Image Pull Secrets**: Use harbor-credentials for private registry access

### Buildx Docker Build Pattern

Following the alga-psa build pattern, the temporal-worker build must:

1. **Use Docker-in-Docker sidecar**: Run docker:27-dind as privileged sidecar
2. **Configure buildx builder**: Create builder with docker-container driver
3. **Node-specific cache**: Create PVC bound to the build node for cache persistence
4. **Multi-registry push**: Push to both Harbor and GitHub Container Registry
5. **Platform specification**: Build for linux/amd64 explicitly
6. **Cache configuration**: Use local cache type with mode=max for optimal caching

Example buildx command pattern:
```bash
docker buildx build \
  --platform linux/amd64 \
  --push \
  --cache-from type=local,src=/buildx-cache \
  --cache-to type=local,dest=/buildx-cache,mode=max \
  --file ee/temporal-workflows/Dockerfile \
  -t harbor.nineminds.com/nineminds/temporal-worker:$SHA \
  .
```

### Security Considerations

1. **Secret Rotation**: Plan for API key rotation without downtime
2. **Network Policies**: Restrict traffic to only required services
3. **RBAC**: Minimal permissions for service account
4. **Image Scanning**: Ensure images are scanned for vulnerabilities
5. **Pod Security**: Run as non-root user with read-only filesystem

### Potential Issues and Mitigations

1. **Database Connection Pool Exhaustion**
   - Mitigation: Configure appropriate pool sizes and connection limits
   - Monitor active connections

2. **Temporal Worker Overwhelm**
   - Mitigation: Configure appropriate concurrency limits
   - Use HPA for automatic scaling

3. **Secret Injection Failures**
   - Mitigation: Add init containers to verify secrets
   - Implement graceful degradation

4. **Network Connectivity Issues**
   - Mitigation: Implement retry logic with exponential backoff
   - Add circuit breakers for external services

## Implementer's Scratch Pad

### Pre-deployment Checklist
- [ ] Vault access verified
- [ ] Database connectivity tested (in msp namespace)
- [ ] Temporal server reachable
- [ ] Image built and pushed to Harbor
- [ ] Secrets created in Vault (including ALGA_AUTH_KEY)
- [ ] Service accounts configured
- [ ] Harbor credentials configured for image pull

### Deployment Notes
<!-- Track deployment progress and issues here -->

**Date**: 2025-07-27
**Deployer**: Claude Code

**Implementation Progress**:
- Starting Phase 1: Infrastructure Preparation and Secret Setup
- Creating Kubernetes manifests for temporal worker deployment
- Completed Phase 2: Created all Helm templates for temporal worker
- Completed Phase 3: Created Argo build workflow 
- Completed Phase 4: Created deployment and composite workflows
- Created comprehensive deployment documentation

**Completed Items**:
1. Helm Templates:
   - deployment.yaml with full Vault integration
   - service.yaml, configmap.yaml, hpa.yaml, pdb.yaml
   - serviceaccount.yaml and secrets.yaml
   
2. Configuration:
   - Added temporal worker config to helm/values.yaml
   - Updated hosted.values.yaml with production settings
   
3. Workflows:
   - temporal-worker-build-workflow.yaml with buildx caching
   - temporal-worker-deploy-workflow.yaml with health checks
   - Composite workflow with auto-detection of changes
   
4. Documentation:
   - Comprehensive deployment guide in nm-kube-config
   - Covers building, deploying, troubleshooting, monitoring

**Staging Deployment**:
- Start time: 
- End time: 
- Issues encountered: 
- Resolution: 

**Production Deployment**:
- Start time: 
- End time: 
- Issues encountered: 
- Resolution: 

### Performance Observations
<!-- Record actual resource usage and performance metrics -->

- Initial CPU usage: 
- Initial memory usage: 
- Peak CPU during load: 
- Peak memory during load: 
- Optimal replica count: 
- HPA threshold adjustments: 

### Post-deployment Tasks
- [ ] Update documentation
- [ ] Share deployment notes with team
- [ ] Schedule post-mortem if issues occurred
- [ ] Plan for next iteration improvements

### Questions for Review
<!-- Add questions that arise during implementation -->

1. 
2. 
3. 

### Rollback Record
<!-- If rollback was needed, document why and how -->

**Rollback Executed**: Yes/No
**Reason**: 
**Steps Taken**: 
**Lessons Learned**: 