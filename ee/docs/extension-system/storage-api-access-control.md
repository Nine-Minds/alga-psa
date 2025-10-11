# Storage API Access Control

This document captures the Phase 1 security and RBAC requirements for the extension storage API.

## Capability Model

- The storage host API is gated by the `alga.storage` capability in the extension manifest.
- Capability grants are scoped to a single extension install; revoking the install immediately disables all storage calls.
- Capability flags:
  - `read`: enables `storage.get` and `storage.list`.
  - `write`: enables `storage.put`, `storage.bulkPut`, and `storage.delete`.
  - Extensions request `read`, `write`, or both; the host may downgrade to read-only during review.
- Runner validates capabilities at call time before any database interaction. Unauthorized requests return `403 UNAUTHORIZED`.

## Auth & RBAC

- WASM handlers authenticate using the Runner-issued invocation token, implicitly scoped to tenant and install.
- Iframe SDK calls route through the API Gateway, which enforces:
  - Tenant session auth (host user must have extension access).
  - Extension install membership (user must belong to tenant).
  - Capability check mirrored from Runner to maintain parity.
- API Gateway signs requests to Runner with service credentials; extensions never see database credentials or internal secrets.

## Tenancy Isolation

- All queries key on `tenant_id` and `extension_install_id`. Citus distribution key is `tenant_id` to prevent cross-tenant joins.
- Runner restricts namespace access to manifests declared by the extension; attempts to read/write undeclared namespaces result in `403`.

## Audit Logging

- Every mutation (`put`, `bulkPut`, `delete`) emits an audit record containing:
  - `tenant_id`, `extension_install_id`, `namespace`, `key`
  - `operation`, `revision`, `schemaVersion`
  - Caller context (`runner_invocation_id` or host session id)
- Read operations log at debug level with sampling to control volume (configurable).
- Audit logs stream to the central pipeline and are retained 90 days by default.

## Rate Limiting

- Rates enforced per extension install using the shared limiter:
  - Write-heavy ops default to 60 ops/min burst 180.
  - Read ops default to 200 ops/min burst 400.
- Gateway and Runner share the same limiter backend to keep counters consistent.

## Deployment & Feature Flags

- Capability checks hidden behind `storageApiEnabled` feature flag per environment.
- Initial rollout restricts to allowlist of extension ids until GA.
- Rollback path disables flag, preventing new storage calls while leaving data intact.
- Runner integration requires `STORAGE_API_BASE_URL` and `RUNNER_STORAGE_API_TOKEN` environment variables; requests must present the token via `x-runner-auth`.

## Developer Documentation Updates

- Update `ee/docs/extension-system/overview.md` to mention the storage API and capability requirements.
- Extend the SDK README with usage examples referencing capability flags.
- Provide manifest snippet:
  ```jsonc
  {
    "capabilities": {
      "alga.storage": {
        "namespaces": [
          { "name": "settings", "schemaReference": "./schemas/settings.json", "access": ["read", "write"] }
        ]
      }
    }
  }
  ```
