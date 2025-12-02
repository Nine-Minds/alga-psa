# Comprehensive Extension System Analysis Report (Enterprise v2)

Date: Aug 2025

This report describes the Enterprise v2 extension architecture and the design decisions behind it. The system prioritizes multi‑tenant isolation, signed and content‑addressed artifacts, a strict API Gateway, and iframe‑only UI hosted by the Runner.

## Executive Summary

The v2 model provides:
- Out‑of‑process execution in a dedicated Runner (Rust + Wasmtime) with resource limits and capability‑scoped host APIs
- Signed, content‑addressed bundles stored in object storage and verified at install and load time
- A Next.js API Gateway at `/api/ext/[extensionId]/[[...path]]` (manifest endpoints advisory) that proxies to Runner `POST /v1/execute` with strict header/size/time policies
- UI delivered exclusively via sandboxed iframes; static assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`

These choices materially improve isolation, provenance, security, and operability.

## Target Architecture

- Runner (Rust + Wasmtime)
  - Pooling allocator, epoch timeouts, memory caps, optional fuel
  - Capability‑scoped host APIs: storage, http egress, secrets, logging, metrics
  - Static UI hosting by content hash at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
  - Execute endpoint: `POST /v1/execute`
- Registry & Bundles
  - Tables: `extension_registry`, `extension_version`, `extension_bundle`, `tenant_extension_install`, `extension_event_subscription`, `extension_execution_log`, `extension_quota_usage`
  - Version metadata includes `content_hash`, signatures, runtime, optional precompiled artifacts
- Gateway (Next.js)
  - Route: `/api/ext/[extensionId]/[[...path]]`
  - Resolves tenant install → version → manifest endpoint
  - Normalizes request and proxies to Runner `POST /v1/execute`
- UI Delivery (Runner‑hosted)
  - Immutable static assets at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
  - Host constructs iframe src via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)

## Data Model (Initial)

- `extension_registry`, `extension_version`, `extension_bundle`
- `tenant_extension_install`, `extension_event_subscription`
- `extension_execution_log`, `extension_quota_usage`

See: [registry_implementation.md](registry_implementation.md) and [manifest_schema.md](manifest_schema.md)

## Security and Policy

- No tenant code executes in the core app process
- Signed, content‑addressed bundles (sha256:…) with verification against a trust bundle
- Capability‑based host APIs; deny‑by‑default egress with allowlists
- Gateway header allowlists and size/time limits; Runner response header allowlists
- Sandboxed iframe UI; origin validation aligned with `RUNNER_PUBLIC_BASE`

## Observability

- Structured execution logs with correlation IDs (request/tenant/extension/version/content_hash)
- Metrics for invocation duration, memory, fuel, egress bytes, and errors

## References

- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Overview](overview.md)
- Gateway route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe bootstrap and src builder: [server/src/lib/extensions/ui/iframeBridge.ts](../../../server/src/lib/extensions/ui/iframeBridge.ts:38)
- Registry service scaffold: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
