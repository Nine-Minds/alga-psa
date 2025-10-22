# Storage API Access Control

> **Status:** Archived. The extension-bound storage API has been replaced by the tenant-wide Alga Storage Service.

Access control, authentication, and authorization guidance now lives in the [Alga Storage Service documentation](../../../docs/storage-system.md). Storage capabilities are no longer declared in extension manifests—tenants provision storage keys directly and share them with any runtime (extensions, workflows, or external integrations) that requires access.

If you maintain legacy code that still depends on runner-issued storage credentials, migrate to the tenant storage key flow described in the official documentation and remove any extension-level capability configuration.
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
