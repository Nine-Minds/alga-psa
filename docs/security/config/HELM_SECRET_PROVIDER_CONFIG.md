# Helm Secret Provider Configuration

This document explains how to configure the composite secret provider system in Kubernetes using Helm charts.

## Overview

The Helm charts support the same composite secret provider system as Docker deployments, but with additional Kubernetes-specific features:

- **Values-based configuration**: Configure providers through Helm values files
- **Environment-specific defaults**: Different values files for different deployment environments
- **Conditional vault configuration**: Vault settings only applied when vault is used
- **Setup job integration**: Secret provider configuration for database initialization jobs

## Configuration Structure

### Values File Structure

```yaml
secrets:
  # Comma-separated list of providers for reading secrets
  readChain: "env,filesystem,vault"
  
  # Single provider for writing secrets
  writeProvider: "filesystem"
  
  # Optional environment variable prefix
  envPrefix: ""
  
  # Vault configuration (only used when vault is in readChain or writeProvider)
  vault:
    addr: "https://vault.example.com"
    token: "hvs.xxxxx"
    appSecretPath: "kv/data/app/secrets"
    tenantSecretPathTemplate: "kv/data/tenants/{tenantId}/secrets"
```

## Environment-Specific Configurations

### Development (`values.yaml`)
```yaml
secrets:
  readChain: "env,filesystem"
  writeProvider: "filesystem"
  envPrefix: ""
  vault:
    addr: ""
    token: ""
```

**Use case**: Local development and testing with simple env var overrides.

### Production (`prod.values.yaml`)
```yaml
secrets:
  readChain: "env,filesystem,vault"
  writeProvider: "filesystem"
  envPrefix: ""
  vault:
    addr: "https://vault.company.com"
    token: ""  # Provided via environment or secret
```

**Use case**: Production environments with vault integration for enterprise secrets.

### Host Environment (`host.values.yaml`)
```yaml
secrets:
  readChain: "env,filesystem,vault"
  writeProvider: "filesystem"
  envPrefix: ""
  vault:
    addr: "https://vault-internal.cluster.local"
    token: ""  # Mounted via kubernetes secret
```

**Use case**: On-premises or dedicated host deployments with internal vault.

### Development Environment (`values-dev-env.yaml`)
```yaml
secrets:
  readChain: "env,filesystem"
  writeProvider: "filesystem"
  envPrefix: ""
```

**Use case**: Development branches and PR environments.

## Deployment Methods

### 1. Override via Command Line

```bash
helm upgrade --install alga-psa ./helm \
  --set secrets.readChain="env,vault" \
  --set secrets.vault.addr="https://vault.example.com" \
  --set secrets.vault.token="hvs.xxxxx"
```

### 2. Custom Values File

Create `custom-values.yaml`:
```yaml
secrets:
  readChain: "env,filesystem,vault"
  writeProvider: "vault"
  vault:
    addr: "https://vault.company.com"
    token: "hvs.xxxxx"
```

Deploy with:
```bash
helm upgrade --install alga-psa ./helm \
  -f values.yaml \
  -f custom-values.yaml
```

### 3. Environment Variables Override

Set environment variables in the pod:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: secret-provider-override
data:
  SECRET_READ_CHAIN: "env,vault"
  SECRET_WRITE_PROVIDER: "vault"
  VAULT_ADDR: "https://vault.example.com"
```

Reference in deployment:
```yaml
spec:
  containers:
  - name: app
    envFrom:
    - configMapRef:
        name: secret-provider-override
```

## Vault Integration

### Using Kubernetes Secrets for Vault Token

1. Create a Kubernetes secret:
```bash
kubectl create secret generic vault-credentials \
  --from-literal=token="hvs.xxxxx"
```

2. Update values to reference the secret:
```yaml
secrets:
  vault:
    addr: "https://vault.example.com"
    # Token will be provided via mounted secret or environment
    token: ""
```

3. Mount the secret in deployment (modify `deployment.yaml`):
```yaml
env:
- name: VAULT_TOKEN
  valueFrom:
    secretKeyRef:
      name: vault-credentials
      key: token
```

### Using Vault Agent Sidecar

For advanced vault integration, use Vault Agent as a sidecar:

```yaml
spec:
  containers:
  - name: vault-agent
    image: vault:latest
    # Vault agent configuration for automatic token renewal
  - name: app
    # Main application container
    env:
    - name: VAULT_TOKEN
      value: "/vault/secrets/token"
    volumeMounts:
    - name: vault-secrets
      mountPath: /vault/secrets
```

## Generated Environment Variables

The Helm templates generate these environment variables in the application pods:

### Always Present
- `SECRET_READ_CHAIN`: From `secrets.readChain`
- `SECRET_WRITE_PROVIDER`: From `secrets.writeProvider`

### Conditional
- `SECRET_ENV_PREFIX`: Only if `secrets.envPrefix` is set
- `VAULT_ADDR`: Only if vault is used and `secrets.vault.addr` is set
- `VAULT_TOKEN`: Only if vault is used and `secrets.vault.token` is set
- `VAULT_APP_SECRET_PATH`: Only if vault is used and path is specified
- `VAULT_TENANT_SECRET_PATH_TEMPLATE`: Only if vault is used and template is specified

## Affected Components

The secret provider configuration is applied to:

1. **Main Application Deployment** (`templates/deployment.yaml`)
   - Primary application container
   - All secret provider environment variables

2. **Setup Jobs** (`templates/jobs.yaml`)
   - Database initialization jobs
   - Same secret provider configuration as main app

3. **Hocuspocus Deployment** (conditionally)
   - If hocuspocus uses application secrets (currently uses separate DB secrets)

## Validation and Troubleshooting

### Check Configuration
View the actual environment variables in a running pod:
```bash
kubectl exec -it deployment/alga-psa -- env | grep SECRET
kubectl exec -it deployment/alga-psa -- env | grep VAULT
```

### Validate Template Rendering
Test Helm template rendering locally:
```bash
helm template alga-psa ./helm -f values.yaml --debug
```

### Common Issues

1. **Vault connection errors**
   - Check `VAULT_ADDR` is accessible from cluster
   - Verify `VAULT_TOKEN` has correct permissions
   - Ensure vault paths exist

2. **Missing environment variables**
   - Verify values file syntax
   - Check Helm template conditions
   - Confirm vault configuration is properly nested

3. **Template syntax errors**
   - Use `helm template --debug` to validate
   - Check for proper YAML indentation
   - Verify Helm function syntax

### Debugging Steps

1. **Check rendered templates**:
   ```bash
   helm template alga-psa ./helm -f prod.values.yaml > rendered.yaml
   grep -A 20 -B 5 "SECRET_READ_CHAIN" rendered.yaml
   ```

2. **Validate in running pod**:
   ```bash
   kubectl exec deployment/alga-psa -- cat /proc/1/environ | tr '\0' '\n' | grep SECRET
   ```

3. **Check application logs**:
   ```bash
   kubectl logs deployment/alga-psa | grep "secret provider"
   ```

Expected log messages:
- `Building composite secret provider. Read chain: [env, filesystem], Write provider: filesystem`
- `EnvSecretProvider initialized without prefix`
- `CompositeSecretProvider initialized with 2 read providers and 1 write provider`

## Migration from Legacy Configuration

### Before (Legacy)
```yaml
# Old way - single provider
config:
  secretProvider:
    type: "filesystem"  # or "vault"
```

### After (Composite)
```yaml
# New way - composite providers
secrets:
  readChain: "env,filesystem"  # or "env,filesystem,vault"
  writeProvider: "filesystem"  # or "vault"
```

The application automatically detects and uses the new configuration while maintaining backward compatibility with legacy `SECRET_PROVIDER_TYPE` environment variables.

## Security Best Practices

1. **Never commit vault tokens to values files**
   - Use Kubernetes secrets or environment variables
   - Consider vault agent for token management

2. **Use least privilege vault policies**
   - Restrict vault token permissions to required paths
   - Use renewable tokens when possible

3. **Secure filesystem secrets**
   - Use Kubernetes secrets instead of plain files
   - Set appropriate file permissions (600)

4. **Environment variable precedence**
   - Leverage env provider for temporary overrides
   - Use filesystem/vault for persistent secrets

5. **Regular token rotation**
   - Implement vault token rotation procedures
   - Monitor token expiration in logs