# Alga PSA Extension System (Enterprise Overview)
> Status
>
> This page describes the target Enterprise Extension System. Parts of this architecture are implemented, while others are in progress. See "What is live now" and "What’s next" below for the current state.

## What is live now

- Legacy filesystem scanning for tenant code is disabled; initialization does not load tenant code into the host process.
  - Evidence: initializeExtensions() logs indicate the legacy scan is disabled (see [ee/server/src/lib/extensions/initialize.ts](ee/server/src/lib/extensions/initialize.ts)).
- Dynamic import of tenant-supplied UI into the host is deprecated; the UI model is migrating to iframe-only.
  - Evidence: The renderer displays a migration notice indicating iframe-only UI (see [ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx](ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx)).
- Iframe bootstrap and security behavior (sandbox defaults, origin validation, theme token bridge, message protocol) are implemented on the client side.
  - Evidence: The iframe bridge enforces sandbox="allow-scripts", validates origins (based on RUNNER_PUBLIC_BASE), injects theme tokens, and handles postMessage for ready/resize/navigate (see [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts)).
- Registry v2 service/types exist as scaffolding and are not yet wired to the database.
  - Evidence: ExtensionRegistryServiceV2 methods return placeholders and do not integrate with DB (see [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts)).

## What’s next (planned/in progress)

- Implement API gateway route /api/ext/[extensionId]/[...path] that proxies to the Runner with strict header/timeout/body policies (as specified in the API Routing Guide).
- Implement ext-ui asset serving path /ext-ui/{extensionId}/{content_hash}/[...] with immutable cache semantics.
- Enforce Manifest v2 (runtime, capabilities, endpoints, ui) in server validation and routing; maintain a migration from legacy descriptor-based manifests.
- Wire Registry v2 to the database, implement publish/install flows, and signature verification against a trust bundle.


This document describes the Enterprise Edition extension architecture focused on strong multi‑tenant isolation, signed/reproducible artifacts, and a secure, capability‑based runtime.

## Goals
- No tenant code executes in the core app process
- Per‑tenant isolation across compute, storage, and egress
- Signed, content‑addressed bundles with verified provenance
- Capability‑based host APIs, quotas, and auditable execution

## Architecture

1) Runner Service (Rust + Wasmtime)
- Executes extension handlers as WASM modules
- Enforces memory/time/concurrency limits
- Exposes a minimal set of namespaced host APIs (`alga.*`) for storage, http, secrets, logging, and metrics

2) Registry & Bundles
- Registry stores extensions, versions, and metadata (`content_hash`, `signature`, runtime)
- Bundles are immutable, content‑addressed artifacts in object storage; signatures verified at install and on load

3) API Gateway (Next.js)
- Route: `/api/ext/[extensionId]/[...path]`
- Resolves tenant install → version → manifest endpoint
- Proxies to Runner `POST /v1/execute` with strict header/size/time policies and quotas

4) UI Delivery (Iframe‑Only)
- Route: `/ext-ui/{extensionId}/{content_hash}/[...]`
- Pod‑local cache of signed UI assets served with immutable caching
- Client SDK (`@alga/extension-iframe-sdk`) provides auth, navigation, theme bridge
- UI kit (`@alga/ui-kit`) offers accessible, themed components

5) Observability & Policy
- Structured execution logs correlated to requests/events
- Prometheus metrics (duration, memory, fuel, egress bytes, errors)
- Per‑tenant/per‑extension quotas and egress allowlists

## Data Model (Initial)
- `extension_registry`, `extension_version`, `extension_bundle`
- `tenant_extension_install`, `extension_event_subscription`
- `extension_execution_log`, `extension_quota_usage`

## Request Flow (HTTP)
1. User calls `/api/ext/{extensionId}/{...}` in the host app
2. Gateway resolves tenant install/version and manifest endpoint
3. Gateway filters headers/body and calls Runner `/v1/execute`
4. Runner fetches/verifies module by `content_hash`, executes handler, returns normalized response
5. Gateway maps response to the client with header allowlists

## Security Highlights
- No raw dynamic imports of tenant JS into host
- Capability‑based host API; deny‑by‑default egress
- Signature verification and content hashing across bundle lifecycle

## Migration Notes
- Descriptor‑based host UI rendering is deprecated
- `/api/extensions/...` routes are replaced by `/api/ext/[extensionId]/[...]`
- Extensions are installed from signed bundles; server does not persist tenant code

## References
- [Implementation Plan](implementation_plan.md)
- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Development Guide](development_guide.md)
