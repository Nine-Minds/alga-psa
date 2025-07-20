# Composite Secrets Migration Plan

## Introduction

This document describes the steps required to migrate the code-base from the current *single* secret-provider model to a **composite secrets system** that:

1. Reads secrets through an ordered chain of providers (e.g. `env → filesystem → vault`).
2. Writes and mutates secrets through *exactly one* authoritative provider.
3. Is fully configured by environment variables so that the same container image can run in local development, Docker Compose, Kubernetes, or on bare VMs.

The migration purposefully leaves the existing concrete providers (`Env`, `FileSystem`, `Vault`) untouched.  All changes are additive or encapsulated in a new *composite* provider and updated wiring logic.

---

## Table of Contents

1. [Existing Code & Artefacts to Inspect](#existing-code--artefacts-to-inspect)
2. [Phased Migration Checklist](#phased-migration-checklist)
3. [Implementation Details & Rationales](#implementation-details--rationales)

---

## Existing Code & Artefacts to Inspect

| Area | Paths | Status |
|------|-------|---------|
| Interface & providers | `shared/core/ISecretProvider.ts`, `shared/core/FileSystemSecretProvider.ts`, `shared/core/VaultSecretProvider.ts`, *new* `EnvSecretProvider.ts` | ✅ **Analyzed** |
| Factory / singleton | `shared/core/secretProvider.ts` | ✅ **Analyzed** |
| Docker build files | `Dockerfile*`, `docker-compose.*.yaml` in project root | ✅ **Analyzed** |
| Kubernetes / Helm | `helm/**` charts & `values.yaml` files | ✅ **Analyzed** |

### Current Implementation Analysis

**Interface Design (`ISecretProvider.ts`):**
- ✅ Clean async interface with 4 methods: `getAppSecret`, `getTenantSecret`, `setTenantSecret`, `deleteTenantSecret`
- ✅ Proper return types: `Promise<string | undefined>` for reads, `Promise<void>` for writes
- ✅ Interface is sufficient for composite pattern implementation

**Existing Providers:**
- ✅ `FileSystemSecretProvider`: Full CRUD, honors `SECRET_FS_BASE_PATH`, defaults to `/run/secrets` → `../secrets`
- ✅ `VaultSecretProvider`: Full CRUD, honors all `VAULT_*` environment variables, proper KV v2 support
- ✅ Both providers correctly return `undefined` for missing secrets (no null/throw issues)

**Factory Pattern (`secretProvider.ts`):**
- ✅ Singleton pattern with `getSecretProviderInstance()`
- ✅ Uses `SECRET_PROVIDER_TYPE` environment variable (defaults to 'filesystem')
- ✅ 44 usage points across 17 files - all go through factory (no direct instantiation found)

**Current Configuration:**
- ❌ No `SECRET_PROVIDER_TYPE` configured in Docker/Helm files (system uses filesystem default)
- ❌ No secret provider tests exist
- ✅ Environment variable support ready in existing providers

---

## Codebase Analysis Results

### Secret Provider Usage Patterns (✅ Compatible)

**Current Usage Statistics:**
- ✅ **44 usage points** across 17 files - all go through `getSecretProviderInstance()` factory
- ✅ **Zero direct provider instantiation** found - perfect factory pattern compliance
- ✅ **All usage points are automatically compatible** with composite provider

**Primary Usage Areas:**
- **Email/OAuth Integration**: Microsoft Graph, Gmail authentication and credential management
- **QuickBooks Integration**: QBO client authentication, OAuth flows, credential storage
- **Infrastructure**: Workflow system secret retrieval, PubSub configuration, utility functions

**Files Using Secret Provider (All Compatible):**
- `server/src/services/email/providers/MicrosoftGraphAdapter.ts` - OAuth tokens
- `server/src/services/email/providers/GmailAdapter.ts` - Client credentials  
- `server/src/app/api/auth/*/callback/route.ts` - OAuth callback handling
- `server/src/lib/qbo/qboClientService.ts` - QuickBooks authentication
- `server/src/lib/actions/integrations/qboActions.ts` - QBO credential management
- `shared/workflow/init/registerWorkflowActions.ts` - Workflow secret access

### Hardcoded Environment Variable Lookups (❌ Needs Migration)

**Critical Secrets Still Using `process.env` (High Priority):**

**Authentication & Authorization:**
- `server/src/utils/tokenizer.tsx:8` - `SECRET_KEY` (JWT signing)
- `server/src/middleware/authorizationMiddleware.ts:13` - `NEXTAUTH_SECRET`
- `server/src/app/api/auth/[...nextauth]/options.ts:35-36` - `GOOGLE_OAUTH_CLIENT_ID/SECRET`
- `server/src/app/api/auth/[...nextauth]/options.ts:191-193` - Keycloak credentials

**Database Passwords:**
- `shared/db/connection.ts:17` - `DB_PASSWORD_SERVER`
- `ee/temporal-workflows/src/db/connection.ts:19,44` - Multiple database passwords

**API Keys & External Services:**
- `tools/ai-automation/web/src/lib/llm/factory.ts:9-10` - OpenAI API keys
- `ee/server/src/services/chatStreamService.ts:40` - `ANTHROPIC_API_KEY`
- `ee/temporal-workflows/src/services/email-service.ts:365` - `RESEND_API_KEY`
- `server/src/lib/api/services/SdkGeneratorService.ts` - `ALGA_PSA_API_KEY`

**Cloud & Infrastructure:**
- `server/src/config/storage.ts:34-35` - AWS S3 credentials
- `server/src/utils/email/emailService.tsx:78-79` - SMTP credentials
- `services/workflow-worker/test-redis.js:18` - `REDIS_PASSWORD`

### Direct Filesystem Secret Access (❌ Needs Migration)

**Files Bypassing Secret Provider (4 instances):**
1. `test-config/e2e-test-runner/lib/database-validator.js:32` - Direct postgres_password read
2. `server/setup/create_database.js:20` - Custom `getSecret` function with direct `fs.readFileSync`
3. `ee/server/setup/create_database.js:20` - Duplicate of above
4. `shared/core/getSecret.ts:24` - Legacy utility with direct `fs.readFile`

### Direct Vault Access (✅ Clean)

**Analysis Result: Zero instances of direct vault access found**
- ✅ All Vault interactions properly go through `VaultSecretProvider`
- ✅ No direct `node-vault` imports outside the provider implementation
- ✅ No HTTP calls to Vault API endpoints
- ✅ Architecture properly encapsulates vault access

---

## Phased Migration Checklist

The list is ordered by dependency; a later item assumes all previous items are complete.

### Phase 1 – Preparatory clean-up

- [x] **Review `ISecretProvider` and confirm its methods cover all current usages.**
  - ✅ Interface defines 4 methods: `getAppSecret`, `getTenantSecret`, `setTenantSecret`, `deleteTenantSecret`
  - ✅ Return types are appropriate: `Promise<string | undefined>` for reads, `Promise<void>` for writes
  - ✅ Interface is sufficient for composite pattern - no changes needed
- [x] **Ensure both current providers return `undefined` (not `null` or throw) when a secret is missing.**
  - ✅ `FileSystemSecretProvider` returns `undefined` for missing files (verified in implementation)
  - ✅ `VaultSecretProvider` returns `undefined` for 404 responses (verified in implementation)
  - ✅ No changes needed to existing providers

### Phase 2 – Composite provider & factory ✅

- [x] **Create `shared/core/EnvSecretProvider.ts` implementing `ISecretProvider`.**
  - ✅ Read from `process.env` with optional `SECRET_ENV_PREFIX` support
  - ✅ App secrets: `process.env[name]` or `process.env[PREFIX_name]`
  - ✅ Tenant secrets: `process.env[TENANT_tenantId_name]` or `process.env[PREFIX_TENANT_tenantId_name]`
  - ✅ Write operations throw error (env vars are read-only)
- [x] **Create `shared/core/CompositeSecretProvider.ts` implementing `ISecretProvider`.**
  - ✅ Constructor accepts `readProviders: ISecretProvider[]` and `writeProvider: ISecretProvider`
  - ✅ Read methods: iterate through `readProviders`, return first non-`undefined` value
  - ✅ Write methods: delegate to `writeProvider`
  - ✅ Error handling: if no provider returns a value, return `undefined`
- [x] **Add factory function `buildSecretProviders()` in `shared/core/secretProvider.ts`.**
  - ✅ Parse `SECRET_READ_CHAIN` (comma-separated): `"env,filesystem,vault"`
  - ✅ Parse `SECRET_WRITE_PROVIDER` (single provider): `"filesystem"`
  - ✅ Default: `SECRET_READ_CHAIN="env,filesystem"`, `SECRET_WRITE_PROVIDER="filesystem"`
  - ✅ Instantiate concrete providers once as singletons (cache in module scope)
  - ✅ Return configured `CompositeSecretProvider` instance
- [x] **Update `getSecretProviderInstance()` to use new factory.**
  - ✅ If `SECRET_READ_CHAIN` or `SECRET_WRITE_PROVIDER` exist, use `buildSecretProviders()`
  - ✅ Otherwise fall back to legacy `SECRET_PROVIDER_TYPE` logic for backward compatibility
  - ✅ Maintain singleton behavior for the returned composite provider
- [x] **Add validation for provider configuration.**
  - ✅ Validate provider names in `SECRET_READ_CHAIN` are supported: `env`, `filesystem`, `vault`
  - ✅ Validate `SECRET_WRITE_PROVIDER` is one of the supported providers
  - ✅ Validate required environment variables exist for configured providers (e.g., `VAULT_ADDR` for vault)
  - ✅ Throw descriptive errors for invalid configurations

### Phase 3 – Testing & validation

- [ ] **Create comprehensive unit tests for new providers.**
  - `EnvSecretProvider`: Test prefix support, tenant secret patterns, read-only behavior
  - `CompositeSecretProvider`: Test read chain iteration, write delegation, edge cases
  - Factory functions: Test environment variable parsing, provider instantiation, validation
- [ ] **Create integration tests for factory behavior.**
  - Test backward compatibility with `SECRET_PROVIDER_TYPE`
  - Test new environment variable configuration
  - Test error handling for invalid configurations
  - Test singleton behavior across multiple calls
- [ ] **Verify existing provider environment variable support** (these are already implemented):
  - ✅ FileSystem → `SECRET_FS_BASE_PATH` (default `/run/secrets` then `../secrets`)
  - ✅ Vault → `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_APP_SECRET_PATH`, `VAULT_TENANT_SECRET_PATH_TEMPLATE`

### Phase 4 – Update Docker configuration ✅

- [x] **Analysis: Current Docker configuration** (completed analysis):
  - ❌ No current usage of `SECRET_PROVIDER_TYPE` in any Docker files
  - ✅ System currently relies on default filesystem provider behavior
  - ✅ 23 docker-compose files identified, 28 Dockerfile files identified
- [x] **Add default secret provider configuration to main Docker files:**
  ```bash
  # In main Dockerfile and key docker-compose files
  ENV SECRET_READ_CHAIN="env,filesystem"
  ENV SECRET_WRITE_PROVIDER="filesystem"
  ```
  - ✅ Updated `Dockerfile`, `Dockerfile.build`, `Dockerfile.dev`
  - ✅ Added appropriate defaults with documentation references
- [x] **Update key docker-compose files with environment variables:**
  - ✅ `docker-compose.yaml` - Development defaults (`env,filesystem` / `filesystem`)
  - ✅ `docker-compose.prod.yaml` - Production with vault support (`env,filesystem,vault` / `filesystem`)
  - ✅ `docker-compose.ce.yaml` - Community edition (`env,filesystem` / `filesystem`)
  - ✅ `docker-compose.ee.yaml` - Enterprise edition with vault (`env,filesystem,vault` / `filesystem`)
- [x] **Add configuration comments and documentation:**
  - ✅ Created comprehensive `docs/DOCKER_SECRET_PROVIDER_CONFIG.md`
  - ✅ Covers override methods, environment-specific configs, troubleshooting
  - ✅ Added documentation references in Dockerfile comments

### Phase 5 – Helm charts ✅

- [x] **Analysis: Current Helm configuration** (completed analysis):
  - ✅ Main chart located at `helm/` with `values.yaml`, `prod.values.yaml`, `host.values.yaml`, `values-dev-env.yaml`
  - ✅ Multiple deployment templates including main `deployment.yaml` and specialized templates
  - ❌ No current secret provider configuration in values files (before implementation)
- [x] **Add secret provider configuration to `values.yaml` files:**
  ```yaml
  secrets:
    readChain: "env,filesystem,vault"
    writeProvider: "filesystem"
    envPrefix: ""
    vault:
      addr: ""
      token: ""
      appSecretPath: "kv/data/app/secrets"
      tenantSecretPathTemplate: "kv/data/tenants/{tenantId}/secrets"
  ```
  - ✅ Added comprehensive configuration structure to all values files
  - ✅ Included vault configuration options with proper defaults
- [x] **Template new values into Deployment environment lists:**
  - ✅ Updated `helm/templates/deployment.yaml` with secret provider environment variables
  - ✅ Updated `helm/templates/jobs.yaml` for setup job compatibility
  - ✅ Added conditional vault configuration templating
  - ✅ Reference values: `{{ .Values.secrets.readChain }}` and `{{ .Values.secrets.writeProvider }}`
- [x] **Preserve existing Vault integration:**
  - ✅ Vault token file mounts remain unchanged (if they exist)
  - ✅ Only environment variable names change, not the underlying secret mounting
  - ✅ Conditional vault environment variables only when vault is used
- [x] **Update all values files with appropriate defaults:**
  - ✅ `values.yaml`: Development defaults (`env,filesystem` / `filesystem`)
  - ✅ `prod.values.yaml`: Production defaults (`env,filesystem,vault` / `filesystem`)
  - ✅ `host.values.yaml`: Host environment defaults (`env,filesystem,vault` / `filesystem`)
  - ✅ `values-dev-env.yaml`: Development environment configuration (`env,filesystem` / `filesystem`)
- [x] **Create comprehensive Helm documentation:**
  - ✅ Created `docs/HELM_SECRET_PROVIDER_CONFIG.md`
  - ✅ Covers deployment methods, vault integration, troubleshooting
  - ✅ Documents environment-specific configurations and best practices

### Phase 6 – Documentation

- [ ] **Update `docs/overview.md` with new secret provider configuration:**
  - Document new environment variables: `SECRET_READ_CHAIN`, `SECRET_WRITE_PROVIDER`
  - Add configuration examples for different deployment scenarios
  - Explain provider chain behavior and write delegation
- [ ] **Create migration documentation:**
  - Document deprecation of `SECRET_PROVIDER_TYPE` (still supported for backward compatibility)
  - Provide migration examples for common scenarios
  - Document troubleshooting steps for configuration issues
- [ ] **Add configuration examples and best practices:**
  - Local development: `SECRET_READ_CHAIN="env,filesystem"`
  - Docker production: `SECRET_READ_CHAIN="env,filesystem"`
  - Kubernetes with Vault: `SECRET_READ_CHAIN="env,filesystem,vault"`
  - Environment-specific overrides and patterns

### Phase 7 – Application code sweep

- [ ] **Analysis: Current usage patterns** (completed analysis):
  - ✅ All 44 usage points go through `getSecretProviderInstance()` factory
  - ✅ No direct instantiation of `FileSystemSecretProvider` or `VaultSecretProvider` found
  - ✅ No application code changes needed - factory handles all routing
- [ ] **Verify factory integration points:**
  - Confirm all imports still work with updated factory
  - Test that existing code paths work with composite provider
  - Validate error handling remains consistent
  - Use subtasks to search through batches of files!

### Phase 8 – Migrate hardcoded secret lookups

- [ ] **Migrate critical authentication secrets (High Priority):**
  - `server/src/utils/tokenizer.tsx:8` - Replace `process.env.SECRET_KEY` with secret provider
  - `server/src/middleware/authorizationMiddleware.ts:13` - Replace `process.env.NEXTAUTH_SECRET`
  - `server/src/app/api/auth/[...nextauth]/options.ts` - Replace OAuth client credentials
  - `server/src/utils/keycloak.tsx` - Replace Keycloak configuration variables
- [ ] **Migrate database passwords:**
  - `shared/db/connection.ts:17` - Replace `process.env.DB_PASSWORD_SERVER`
  - `ee/temporal-workflows/src/db/connection.ts` - Replace multiple database passwords
- [ ] **Migrate API keys and external service credentials:**
  - `tools/ai-automation/web/src/lib/llm/factory.ts` - Replace OpenAI API keys
  - `ee/server/src/services/chatStreamService.ts` - Replace Anthropic API key
  - `ee/temporal-workflows/src/services/email-service.ts` - Replace Resend API key
  - `server/src/lib/api/services/SdkGeneratorService.ts` - Replace Alga PSA API key
- [ ] **Migrate infrastructure credentials:**
  - `server/src/config/storage.ts` - Replace AWS S3 credentials
  - `server/src/utils/email/emailService.tsx` - Replace SMTP credentials
  - `services/workflow-worker/test-redis.js` - Replace Redis password
- [ ] **Migrate QuickBooks hardcoded credentials:**
  - `server/src/lib/actions/qbo/qboUtils.ts:35-36` - Replace dev access/refresh tokens
  - `server/src/lib/actions/qbo/qboUtils.ts:80-81` - Replace client ID/secret
  - `server/src/lib/api/services/QuickBooksService.ts` - Replace QBO client configuration
- [ ] **Remove legacy direct filesystem access:**
  - `test-config/e2e-test-runner/lib/database-validator.js:32` - Replace direct readFileSync
  - `server/setup/create_database.js:20` - Update custom getSecret function to use provider
  - `ee/server/setup/create_database.js:20` - Update duplicate custom getSecret function
  - `shared/core/getSecret.ts:24` - Update or deprecate legacy utility function

---

## Implementation Details & Rationales

### Provider wiring API

| Variable | Purpose | Default |
|----------|---------|---------|
| `SECRET_READ_CHAIN` | Comma-separated provider names consulted **in order** for reads. | `env,filesystem` |
| `SECRET_WRITE_PROVIDER` | Single provider used for all writes/deletes. | `filesystem` |

**Legacy variable:** `SECRET_PROVIDER_TYPE` is honored for reads *and* writes when the new vars are not set to avoid a flag-day rollout.

**Supported provider names:** `env`, `filesystem`, `vault`

### Composite provider behaviour

* **`getAppSecret` / `getTenantSecret`:** iterate through `readProviders`, return the first non-`undefined` value.
* **`setTenantSecret` / `deleteTenantSecret`:** delegate directly to `writeProvider`.

### Environment variable patterns

**EnvSecretProvider patterns:**
- App secrets: `process.env[secretName]` or `process.env[PREFIX_secretName]` (if `SECRET_ENV_PREFIX` is set)
- Tenant secrets: `process.env[TENANT_tenantId_secretName]` or `process.env[PREFIX_TENANT_tenantId_secretName]`

**Example configurations:**
```bash
# Local development
SECRET_READ_CHAIN="env,filesystem"
SECRET_WRITE_PROVIDER="filesystem"

# Production with Vault
SECRET_READ_CHAIN="env,filesystem,vault"  
SECRET_WRITE_PROVIDER="vault"
VAULT_ADDR="https://vault.example.com"
VAULT_TOKEN="hvs.xxxxx"

# With environment prefix
SECRET_ENV_PREFIX="MYAPP"
MYAPP_DATABASE_PASSWORD="secret123"  # App secret
MYAPP_TENANT_tenant1_API_KEY="key456"  # Tenant secret
```

### Why single write provider?

Keeping one authoritative destination avoids multi-master consistency issues, simplifies error handling, and aligns with common operational patterns. Dual-writes can always be added via a specialized provider if a migration window demands it, but are not part of this focused change.

### Docker / Helm integration

Using env-vars preserves the current pattern (Vault & FS already rely on env-vars), keeps container images generic, and places environment-specific wiring in Compose files and Helm values—exactly where ops teams expect to configure such settings.

### Migration strategy

The migration leverages the existing factory pattern perfectly - since all 44 usage points go through `getSecretProviderInstance()`, updating the factory to return a `CompositeSecretProvider` will automatically work everywhere without requiring application code changes.