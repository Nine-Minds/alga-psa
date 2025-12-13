# Docker Secret Provider Configuration

This document explains the secret provider configuration for Docker and Docker Compose deployments.

## Overview

The application now uses a composite secret provider system that allows for flexible secret management across different deployment environments. The system supports:

- **Environment Variables** (`env` provider)
- **Filesystem Secrets** (`filesystem` provider) 
- **HashiCorp Vault** (`vault` provider)

## Configuration Variables

### `SECRET_READ_CHAIN`
Comma-separated list of providers to try for reading secrets, in order.

**Examples:**
- `env,filesystem` - Try environment variables first, then filesystem
- `env,filesystem,vault` - Try env vars, then filesystem, then Vault
- `filesystem` - Only use filesystem secrets

### `SECRET_WRITE_PROVIDER`
Single provider to use for writing/updating secrets.

**Examples:**
- `filesystem` - Write secrets to filesystem
- `vault` - Write secrets to Vault

## Default Configurations by Environment

### Development (docker-compose.yaml)
```yaml
SECRET_READ_CHAIN: env,filesystem
SECRET_WRITE_PROVIDER: filesystem
```
This allows developers to override secrets via environment variables while falling back to filesystem secrets.

### Production (docker-compose.prod.yaml)
```yaml
SECRET_READ_CHAIN: env,filesystem,vault
SECRET_WRITE_PROVIDER: filesystem
```
Production environments can use all three providers, with Vault as the final fallback for reads.

### Community Edition (docker-compose.ce.yaml)
```yaml
SECRET_READ_CHAIN: env,filesystem
SECRET_WRITE_PROVIDER: filesystem
```
CE edition focuses on simple deployment with environment variables and filesystem secrets.

### Enterprise Edition (docker-compose.ee.yaml)
```yaml
SECRET_READ_CHAIN: env,filesystem,vault
SECRET_WRITE_PROVIDER: filesystem
```
EE edition includes Vault support for enterprise secret management.

## Overriding Configuration

You can override the secret provider configuration in several ways:

### 1. Environment Variables
Set `SECRET_READ_CHAIN` and `SECRET_WRITE_PROVIDER` environment variables before running docker-compose:

```bash
export SECRET_READ_CHAIN="env,vault"
export SECRET_WRITE_PROVIDER="vault"
docker-compose up
```

### 2. .env File
Add to your `.env` file:

```
SECRET_READ_CHAIN=env,filesystem,vault
SECRET_WRITE_PROVIDER=vault
```

### 3. docker-compose.override.yaml
Create a `docker-compose.override.yaml` file:

```yaml
version: '3.8'
services:
  server:
    environment:
      SECRET_READ_CHAIN: env,vault
      SECRET_WRITE_PROVIDER: vault
```

## Vault Configuration

When using the `vault` provider, ensure these environment variables are set:

- `VAULT_ADDR` - Vault server URL (e.g., `https://vault.example.com`)
- `VAULT_TOKEN` - Authentication token for Vault
- `VAULT_APP_SECRET_PATH` - Path for application secrets (default: `kv/data/app/secrets`)
- `VAULT_TENANT_SECRET_PATH_TEMPLATE` - Path template for tenant secrets (default: `kv/data/tenants/{tenantId}/secrets`)

## Migration from Legacy Configuration

The legacy `SECRET_PROVIDER_TYPE` environment variable is still supported for backward compatibility:

- `SECRET_PROVIDER_TYPE=filesystem` → `SECRET_READ_CHAIN=filesystem SECRET_WRITE_PROVIDER=filesystem`
- `SECRET_PROVIDER_TYPE=vault` → `SECRET_READ_CHAIN=vault SECRET_WRITE_PROVIDER=vault`

However, the new composite system is recommended for new deployments.

## Examples

### Local Development with Environment Overrides
```bash
# Override database password via environment variable
export DB_PASSWORD_SERVER="my-local-password"
docker-compose up
```

### Production with Vault Integration
```yaml
# docker-compose.prod.override.yaml
version: '3.8'
services:
  server:
    environment:
      SECRET_READ_CHAIN: env,filesystem,vault
      SECRET_WRITE_PROVIDER: vault
      VAULT_ADDR: https://vault.company.com
      VAULT_TOKEN: ${VAULT_TOKEN}
```

### Kubernetes with ConfigMap Overrides
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: secret-provider-config
data:
  SECRET_READ_CHAIN: "env,filesystem,vault"
  SECRET_WRITE_PROVIDER: "vault"
  VAULT_ADDR: "https://vault.company.com"
```

## Troubleshooting

### Check Current Configuration
The application logs will show the secret provider configuration at startup:

```
INFO: Building composite secret provider. Read chain: [env, filesystem], Write provider: filesystem
```

### Common Issues

1. **Vault connection errors** - Check `VAULT_ADDR` and `VAULT_TOKEN`
2. **Missing filesystem secrets** - Ensure secret files exist in `/run/secrets/`
3. **Permission errors** - Check file permissions on secret files (should be 600)

### Validation Errors
The system validates configuration at startup and will show descriptive error messages:

```
Error: Invalid provider types in SECRET_READ_CHAIN: invalid. Supported types: env, filesystem, vault
Error: VAULT_ADDR environment variable is required when using vault provider
```