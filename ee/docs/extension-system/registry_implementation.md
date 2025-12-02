# Extension Registry Implementation (v2)

The registry catalogs extensions, versions, and bundles and tracks per‑tenant installs with granted capabilities and configuration. This is the authoritative source for manifest resolution, content hashes, signatures, and install state in the v2 architecture.

## Data Model (Initial)

- `extension_registry(id, name, publisher, latest_version, deprecation, created_at)`
- `extension_version(id, registry_id, semver, content_hash, signature, sbom_ref, created_at)`
- `extension_bundle(id, content_hash, storage_url, size, runtime, sdk_version)`
- `tenant_extension_install(id, tenant_id, registry_id, version_id, status, granted_caps, config, created_at)`
- `extension_event_subscription(id, tenant_install_id, event, filter, created_at)`
- `extension_execution_log(id, tenant_id, extension_id, event_id, started_at, finished_at, status, metrics, error)`
- `extension_quota_usage(tenant_id, extension_id, window_start, cpu_ms, mem_mb_ms, invocations, egress_bytes)`

Tenant isolation enforced via RLS and query predicates.

## Services

### Registry Service
- `createRegistryEntry({ name, publisher })`
- `listRegistryEntries(filter)`
- `getRegistryEntry(id)`
- `addVersion(registryId, { semver, content_hash, signature, runtime, precompiled, api, ui, sbom_ref })`
- `deprecate(registryId, reason)`

### Install Service
- `install(tenantId, registryId, semver, { granted_caps, config })` → creates `tenant_extension_install`
- `uninstall(tenantId, registryId)`
- `enable(tenantId, registryId)` / `disable(tenantId, registryId)`
- `update(tenantId, registryId, semver)`

### Signature Verification
- Load trust bundle from `SIGNING_TRUST_BUNDLE` (PEM)
- Verify bundle signature and content hash for `content_hash`

## Bundle Access

- Object storage (S3 compatible) is the source of truth
- Helpers:
  - `getBundleStream(contentHash)`
  - `getBundleIndex(contentHash)`
  - `extractSubtree(contentHash, subtree, dest)` for `dist/` and `ui/`

## Gateway Integration

- Route: `/api/ext/[extensionId]/[[...path]]`
- Steps:
  1. Resolve tenant install for `extensionId`
  2. Resolve active `version_id → content_hash`
  3. Load manifest for that version and match endpoint `{method, path}`
  4. Call Runner `/v1/execute` with normalized request

Gateway scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

## Observability

- Execution logs persisted to `extension_execution_log` with correlation IDs
- Prometheus metrics exposed by Runner; include duration, memory, fuel, egress bytes, errors

## Security & Policy

- Capability grants recorded at install; host imports blocked for missing capabilities
- Egress allowlists per tenant/extension for `http.fetch`
- Secrets retrieved via secret manager handles (no plaintext storage)
- Quotas enforced at gateway and Runner

## References

- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- Registry v2 service scaffold: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
