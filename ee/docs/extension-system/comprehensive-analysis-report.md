# Comprehensive Extension System Analysis Report (Superseded → Overhaul Alignment)

Date: Aug 2025

This report updates prior analysis to align with the Multi‑Tenancy Overhaul. Earlier assessments focused on a descriptor‑based, in‑process model. Those approaches are now deprecated in favor of signed bundles, an out‑of‑process Runner, and iframe‑only UI delivery.

## Executive Summary

Findings from the legacy implementation (in‑process dynamic code execution, filesystem‑based bundles, descriptor rendering in host) presented unacceptable multi‑tenant risk and operational fragility. The overhaul adopts:
- Out‑of‑process execution (Runner, Wasmtime)
- Signed, content‑addressed bundles in object storage
- Gateway proxy (`/api/ext/...`) with strict header/size/time policies
- UI via sandboxed iframes and a Client SDK

This model materially improves isolation, provenance, security, and operability with a clear migration path.

## Key Risks in Legacy Design → Mitigations

1) In‑process code import (server and browser)
- Risk: Arbitrary extension code executed in the app process; blast radius across tenants
- Mitigation: Runner executes WASM modules out‑of‑process with quotas and capability‑scoped host APIs; no raw code imported into the host

2) Filesystem‑based, mutable bundles
- Risk: Path‑based loading from `process.cwd()/extensions` with weak provenance
- Mitigation: Signed, content‑addressed bundles in S3‑compatible store; signature and hash verified on install and load

3) Cross‑tenant registration and weak isolation
- Risk: Global discovery/registration and shared resources
- Mitigation: Per‑tenant installs; RLS‑enforced data model; quotas and egress allowlists per tenant/extension

4) Dynamic import of tenant JS into host UI
- Risk: CSP/privilege escalation and injection into host runtime
- Mitigation: Iframe‑only UI with strict CSP; postMessage bridge; asset serving from cached, signed bundles

## Target Architecture (Brief)

- Runner (Rust + Wasmtime): pooling allocator, epoch timeouts, memory caps, optional fuel; host APIs: `storage.*`, `http.fetch`, `secrets.get`, `log.*`, `metrics.*`
- Registry & Bundles: `extension_registry`, `extension_version`, `extension_bundle`, `tenant_extension_install`, signatures and SBOM refs
- Gateway: Next.js handler at `/api/ext/[extensionId]/[...path]`; resolves manifest endpoints and proxies to Runner `/v1/execute`
- UI Delivery: `/ext-ui/{extensionId}/{content_hash}/[...]` serves cached static assets per content hash

## Data Model (Initial)

- `extension_registry`, `extension_version`, `extension_bundle`, `tenant_extension_install`, `extension_event_subscription`, `extension_execution_log`, `extension_quota_usage`

See: [registry_implementation.md](registry_implementation.md) and [manifest_schema.md](manifest_schema.md)

## Migration Notes

- Descriptor rendering and dynamic module serving are deprecated
- Any legacy endpoints under `/api/extensions/...` should be migrated to `/api/ext/...` and declared in Manifest v2
- UI must be converted to iframe apps using the Client SDK (`@alga/extension-iframe-sdk`) and UI kit

## Acceptance Criteria

- 0 in‑process execution of tenant code in host app
- All extension executions go through Runner; all bundles signed and verified
- Per‑tenant isolation of execution, storage, and egress with quotas
- Observability: structured execution logs, metrics, traces

## References

- Overhaul plan (internal): Multi‑Tenancy Overhaul (Aug 2025)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Overview](overview.md)
