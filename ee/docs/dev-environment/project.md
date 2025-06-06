# On-Demand Development Environments for Alga PSA

## Project Overview

This project aims to create an automated system for spinning up on-demand development environments for Alga PSA pull requests in Kubernetes. Each environment will be namespaced by GitHub PR number and include a complete development stack with code server, mirrord for remote development, and AI automation capabilities.

## Architecture

```
GitHub PR � Helm Deploy � K8s Namespace � Development Environment
    �                        �                    �
  PR-123      �    alga-pr-123-ns    �    [Code Server + PSA + AI Tools]
```

### Core Components

1. **Kubernetes Deployment (via Helm)**
   - Namespace: `alga-pr-{pr-number}`
   - Based on existing `/helm` chart
   - Auto-scaling and resource management

2. **Code Server Environment**
   - VSCode in browser
   - Pre-configured with project dependencies
   - Mirrord integration for remote development
   - Access to full Alga PSA codebase

3. **AI Automation Environment**
   - Full AI automation stack from `/tools/ai-automation`
   - Both web interface and API service
   - Browser automation capabilities
   - UI reflection and testing tools

4. **Enhanced Dev CLI**
   - Automated environment provisioning
   - Port forwarding management
   - Environment lifecycle management
   - Integration with existing `/cli/main.nu`

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Helm Chart Extensions
- [ ] Extend existing helm chart for dev environments
- [ ] Add code-server deployment template
- [ ] Add AI automation service templates
- [ ] Configure namespace isolation and resource limits
- [ ] Add ingress/service configurations for external access

#### 1.2 Code Server Configuration
- [ ] Create Dockerfile based on provided example
- [ ] Install Node.js LTS, npm dependencies
- [ ] Pre-install Claude Code CLI
- [ ] Configure workspace with Alga PSA project
- [ ] Setup mirrord for remote development

#### 1.3 AI Automation Integration
- [ ] Package AI automation tools for K8s deployment
- [ ] Configure web interface (port 3000)
- [ ] Configure API service (port 4000)
- [ ] Setup browser session management
- [ ] Integrate with PSA instance for testing

### Phase 2: CLI Enhancement

#### 2.1 Nushell CLI Extensions
```nu
# New commands to add to cli/main.nu

# Create development environment for PR
def dev-env-create [
    pr_number: int     # GitHub PR number
    --branch: string   # Git branch (defaults to pr/pr_number)
    --edition: string = "ce"  # Edition: ce or ee
    --ai-enabled: bool = true # Include AI automation
] {
    # Implementation
}

# List active development environments
def dev-env-list [] {
    # Show all running dev environments
}

# Connect to development environment
def dev-env-connect [
    pr_number: int     # PR number to connect to
    --port-forward     # Setup port forwarding
    --code-server      # Open code server
] {
    # Implementation
}

# Destroy development environment
def dev-env-destroy [
    pr_number: int     # PR number to destroy
    --force            # Force deletion without confirmation
] {
    # Implementation
}

# Get environment status and URLs
def dev-env-status [
    pr_number?: int    # Optional PR number, shows all if omitted
] {
    # Implementation
}
```

#### 2.2 Environment Management
- [ ] Automated kubectl context management
- [ ] Port forwarding automation

### Phase 3: Advanced Features [ DELAYED ]

#### 3.1 GitHub Integration
- [ ] PR comment integration for environment URLs
- [ ] Automatic cleanup on PR merge/close
- [ ] Status badges and integration

#### 3.2 Enhanced Development Experience
- [ ] Pre-seeded database with test data
- [ ] Hot-reloading for code changes
- [ ] Integrated debugging capabilities
- [ ] Multi-user environment support

#### 3.3 AI Automation Enhancement
- [ ] PR-specific automation testing
- [ ] Automated regression testing
- [ ] UI change detection and validation
- [ ] Performance monitoring integration

## Technical Specifications

### Container Images

#### Code Server Image
```dockerfile
FROM codercom/code-server:latest

USER root

# Install Node.js LTS
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install development tools
RUN npm install -g @anthropic-ai/claude-code && \
    npm install -g mirrord

# Install kubectl and helm
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    curl https://get.helm.sh/helm-v3.12.0-linux-amd64.tar.gz | tar xz && \
    mv linux-amd64/helm /usr/local/bin/

USER coder

# Default workspace
WORKDIR /home/coder/alga-psa
```

#### AI Automation Image
- Based on existing `/tools/ai-automation/Dockerfile`
- Enhanced for Kubernetes deployment
- Configured for development environment integration

### Helm Values Structure

```yaml
# values-dev-env.yaml
nameOverride: "alga-dev"
namespace: "alga-pr-{{ .Values.prNumber }}"

# Code Server Configuration
codeServer:
  enabled: true
  image:
    repository: "harbor.nineminds.com/nineminds/alga-code-server"
    tag: "latest"
  service:
    type: "ClusterIP"
    port: 8080
  ingress:
    enabled: true
    host: "{{ .Values.prNumber }}.dev.alga.nineminds.com"
  
# AI Automation Configuration
aiAutomation:
  enabled: true
  web:
    image:
      repository: "harbor.nineminds.com/nineminds/alga-ai-web"
    service:
      port: 3000
  api:
    image:
      repository: "harbor.nineminds.com/nineminds/alga-ai-api"
    service:
      port: 4000

# Resource Limits
resources:
  limits:
    cpu: "2"
    memory: "4Gi"
  requests:
    cpu: "500m"
    memory: "1Gi"

# Storage for persistent development
persistence:
  enabled: true
  size: "10Gi"
  storageClass: "fast-ssd"
```

### CLI Implementation Details

#### Environment Creation Flow
1. Validate PR number and fetch branch info
2. Generate unique namespace and resource names
3. Deploy Helm chart with PR-specific values
4. Wait for deployment readiness
5. Setup port forwarding (optional)
6. Display access URLs and connection info

#### Environment Management
- Health checks via Kubernetes API
- Resource usage monitoring
- Automatic scaling based on usage
- Cleanup policies for inactive environments

### Security Considerations

#### Network Isolation
- Each PR environment in separate namespace
- Network policies for service isolation
- Ingress with authentication/authorization
- Rate limiting and resource quotas

#### Access Control
- Integration with existing authentication
- Role-based access to environments
- Audit logging for environment access
- Secure secrets management

#### Data Protection
- Isolated databases per environment
- No production data in dev environments
- Encrypted storage for persistent volumes
- Regular backup and cleanup policies

## Configuration Files

### Helm Templates Structure
```
helm/templates/dev-env/
   namespace.yaml
   code-server/
      deployment.yaml
      service.yaml
      ingress.yaml
      configmap.yaml
   ai-automation/
      web-deployment.yaml
      api-deployment.yaml
      services.yaml
      configmaps.yaml
   shared/
       secrets.yaml
       rbac.yaml
       network-policies.yaml
```

### CLI Configuration
```yaml
# dev-env-config.yaml
cluster:
  context: "alga-dev-cluster"
  namespace_prefix: "alga-pr-"
  
ingress:
  domain: "dev.alga.nineminds.com"
  tls_enabled: true
  
resources:
  default_limits:
    cpu: "2"
    memory: "4Gi"
  default_requests:
    cpu: "500m"
    memory: "1Gi"
    
storage:
  class: "fast-ssd"
  size: "10Gi"
  
timeouts:
  deployment: "300s"
  health_check: "60s"
```

## Success Metrics

### Performance Targets
- Environment creation time: < 5 minutes
- Environment destruction time: < 2 minutes
- Code server startup time: < 30 seconds
- AI automation ready time: < 60 seconds

### Resource Efficiency
- Maximum 5 concurrent environments per cluster
- Automatic cleanup after 24 hours of inactivity
- Resource usage monitoring and optimization
- Cost tracking per environment

### Developer Experience
- One-command environment creation
- Automatic port forwarding setup
- Pre-configured development tools
- Seamless integration with existing workflows

## Next Steps

1. **Setup Phase 1 Development**
   - Create development branch for this feature
   - Setup test Kubernetes cluster
   - Begin Helm chart modifications

2. **CLI Development**
   - Extend existing `/cli/main.nu` with new commands
   - Add configuration management
   - Implement basic CRUD operations

3. **Testing and Validation**
   - Test with sample PR environments
   - Validate security and isolation
   - Performance testing and optimization

4. **Documentation and Training**
   - Update developer documentation
   - Create usage guides and tutorials
   - Team training on new workflow

## Dependencies

### External Services
- Kubernetes cluster with sufficient resources
- Container registry (Harbor) for custom images
- DNS management for ingress
- GitHub API access for PR information

### Internal Dependencies
- Existing Helm chart structure
- Current CLI implementation
- AI automation platform
- Development workflow processes

## Risk Mitigation

### Resource Management
- Pod resource limits and quotas
- Automatic cleanup policies
- Monitoring and alerting
- Cost tracking and budgets

### Security Risks
- Network isolation between environments
- Access control and authentication
- Secrets management
- Regular security audits

### Operational Risks
- Backup and disaster recovery
- Monitoring and observability
- Support and troubleshooting procedures
- Documentation and knowledge sharing

---

## IMPLEMENTATION PROGRESS

### Current Status: Phase 1 Complete - Core Infrastructure ✅

#### 🎉 Phase 1 Completed!
All core infrastructure components have been implemented and are ready for testing.

#### ✅ Completed
- Project planning and documentation
- ✅ Helm chart structure created in helm/templates/dev-env/
- ✅ Code-server Dockerfile with Node.js, Claude Code CLI, and mirrord
- ✅ AI automation Kubernetes deployment templates
- ✅ Values template for dev environments
- ✅ Complete CLI implementation with dev-env commands

#### 📝 Implementation Summary
**Helm Chart Structure:**
- `helm/templates/dev-env/` - Complete K8s deployment templates
- Namespace isolation for each PR (`alga-pr-{number}`)
- Code-server deployment with workspace persistence
- AI automation API and web deployments
- Ingress for external access with TLS support
- ConfigMaps for VS Code settings and extensions

**Code-Server Environment:**
- `docker/dev-env/Dockerfile.code-server` - Complete development container
- Node.js 18 LTS, npm packages, development tools
- Claude Code CLI, mirrord, kubectl, helm pre-installed
- VS Code extensions and settings optimized for Alga PSA development
- Git configuration and workspace setup automation

**CLI Commands Implemented:**
- `dev-env-create <pr_number> [options]` - Create new dev environment
- `dev-env-list` - List all active environments
- `dev-env-connect <pr_number> [--port-forward] [--code-server]` - Connect to environment
- `dev-env-destroy <pr_number> [--force]` - Clean up environment
- `dev-env-status [<pr_number>]` - Get environment status and URLs

**Values Configuration:**
- `helm/values-dev-env.yaml` - Template for dev environment values
- Support for both CE and EE editions
- Configurable AI automation enable/disable
- Resource limits and persistence settings
- Ingress and networking configuration

#### 🎯 Next Steps - Ready for Testing
1. ✅ Create helm/templates/dev-env/ directory structure
2. ✅ Build code-server Dockerfile
3. ✅ Create basic deployment templates
4. ✅ Add CLI commands for environment management
5. ✅ **COMPLETED: Helm deployment testing successful**

#### 🧪 Testing Results
**Helm Chart Validation**: ✅ PASSED
- Template generation: 1,406 lines of valid Kubernetes manifests
- Namespace isolation: `alga-pr-999` namespace created correctly
- All components rendered: Code-server, AI automation, PSA stack, storage, networking
- Resource configuration: CPU/memory limits, PVCs, secrets, configmaps
- Service discovery: Internal DNS resolution configured properly

**Generated Components**:
- 1x Namespace (isolated environment)
- 5x PersistentVolumeClaims (workspace, database, redis, storage)
- 8x Services (code-server, AI web/api, PSA, postgres, redis, hocuspocus)
- 6x Deployments (code-server, AI web/api, PSA, hocuspocus)
- 2x StatefulSets (postgres, redis)
- 4x Secrets (app secrets, database, redis, storage)
- 2x ConfigMaps (code-server settings, storage config)
- 1x ServiceAccount + RBAC (cleanup hooks)

**Docker Image Build**: ✅ PASSED
- Image: `harbor.nineminds.com/nineminds/alga-code-server:latest`
- Size: 2.17GB
- Base: `codercom/code-server:latest`
- Tools: Node.js 18, Claude Code CLI, mirrord, kubectl, helm, Docker CLI
- Extensions: TypeScript, Tailwind CSS, Prettier, YAML, Kubernetes, ESLint
- Status: Successfully pushed to Harbor registry

#### 🚀 Ready for Phase 2
Phase 1 is complete! The system is ready for:
- ✅ Initial testing and validation - **PASSED**
- ✅ Docker image building and registry push
- 🔄 Kubernetes cluster deployment testing
- 🔄 CLI workflow validation

---

## USAGE EXAMPLES

### Quick Start - Create Environment for PR #123
```bash
# Navigate to project root
cd /path/to/alga-psa

# Create development environment for PR 123
nu cli/main.nu dev-env-create 123 --branch feature/my-feature --edition ce

# Check status
nu cli/main.nu dev-env-status 123

# Connect with port forwarding
nu cli/main.nu dev-env-connect 123 --port-forward --code-server

# Clean up when done
nu cli/main.nu dev-env-destroy 123
```

### Typical Workflow
1. **Developer creates PR** - PR #456 for feature branch `feature/new-ui`
2. **Create environment**: `nu cli/main.nu dev-env-create 456 --branch feature/new-ui`
3. **Access via browser**: Environment will be available at `https://456.dev.alga.nineminds.com`
4. **Develop and test** using:
   - Code Server: Full VSCode environment with project loaded
   - AI Automation: Testing and validation tools
   - Full PSA stack: Database, Redis, all services running
5. **Share with team**: Send environment URL for review/testing
6. **Clean up**: `nu cli/main.nu dev-env-destroy 456` when PR is merged

### CLI Command Reference
```bash
# List all environments
nu cli/main.nu dev-env-list

# Create with AI automation disabled
nu cli/main.nu dev-env-create 789 --no-ai

# Force destroy without confirmation
nu cli/main.nu dev-env-destroy 789 --force

# Get detailed status for specific environment
nu cli/main.nu dev-env-status 123

# Connect and open code server automatically
nu cli/main.nu dev-env-connect 123 --code-server
```