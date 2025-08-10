# Alga PSA Extension System (Enterprise Overview)

This document specifies the Enterprise Edition (EE) extension architecture. It is a v2-only system featuring out-of-process execution, content-addressed signed bundles, an API Gateway that proxies to the Runner, and iframe-only UI delivery served by the Runner.

## Goals
- No tenant code executes in the core app process
- Per-tenant isolation across compute, storage, and egress
- Signed, content-addressed bundles with verified provenance (sha256:…)
- Capability-based host APIs, quotas, and auditable execution

## Architecture

1) Runner Service (Rust + Wasmtime)
- Executes extension handlers as WASM modules
- Enforces memory/time/concurrency limits
- Exposes a minimal set of namespaced host APIs (alga.*) for storage, http, secrets, logging, and metrics
- Hosts static UI assets for iframe delivery at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]

2) Registry & Bundles
- Registry stores extensions, versions, and metadata (content_hash, signature, runtime)
- Bundles are immutable, content-addressed artifacts in object storage
- Signatures are verified on publish/install and on load, against a configured trust bundle

3) API Gateway (Next.js)
- Route: /api/ext/[extensionId]/[...path]
- Resolves tenant install → version → manifest endpoint
- Proxies requests to Runner POST /v1/execute with strict header/size/time policies and quotas
- Reference scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)

4) UI Delivery (Iframe-Only, served by Runner)
- Static UI assets are served by the Runner at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]
- The host constructs the iframe src via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
- Client SDK (@alga/extension-iframe-sdk) provides auth, navigation bridge, and theme token integration
- UI kit (@alga/ui-kit) offers accessible, themed components

5) Observability & Policy
- Structured execution logs correlated to requests/events
- Prometheus metrics (duration, memory, fuel, egress bytes, errors)
- Per-tenant/per-extension quotas and egress allowlists

## Data Model (Initial)
- extension_registry, extension_version, extension_bundle
- tenant_extension_install, extension_event_subscription
- extension_execution_log, extension_quota_usage

## Request Flow (HTTP)
1. Client calls /api/ext/{extensionId}/{...} in the host app
2. Gateway resolves tenant install/version and manifest endpoint
3. Gateway filters headers/body and calls Runner POST /v1/execute
4. Runner fetches/verifies module by content_hash, executes handler, returns normalized response
5. Gateway maps response to the client with header allowlists

## Manifest v2 Summary
Manifest v2 is the canonical specification for extensions:
- runtime: e.g., wasm32-wasi, and runtime version
- capabilities: least-privilege host APIs requested (storage, http, secrets, etc.)
- api.endpoints: declare HTTP entrypoints that the Gateway resolves and proxies to Runner
- ui.iframe: iframe entry HTML and asset mapping; UI is served by Runner using content-addressed paths
- precompiled and assets: bundle metadata including sha256 content hash and signatures

See full schema: [manifest_schema.md](manifest_schema.md)

## Security Highlights
- No dynamic importing of tenant JS into the host
- Capability-based host API; deny-by-default egress
- Signature verification and content hashing across the bundle lifecycle
- Iframe sandboxing and origin validation aligned with RUNNER_PUBLIC_BASE

## Runner: responsibilities and integration
The Runner is the execution and static asset host for the EE architecture:
- Executes WASM handlers out-of-process with isolation and quotas (Rust + Wasmtime)
- Hosts static UI assets by immutable content hash; the host builds iframe src via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and initializes via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
- Provides HTTP interface for handler execution (POST /v1/execute) called by the API Gateway. Gateway scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)
- Signature and provenance enforcement integrate with Registry v2 services. Registry scaffold: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)

Runner-related configuration (host environment):
- RUNNER_BASE_URL: internal URL used by the Gateway to call POST /v1/execute
- RUNNER_PUBLIC_BASE: public base used to construct ext-ui iframe src
- EXT_GATEWAY_TIMEOUT_MS: gateway → runner request timeout
- SIGNING_TRUST_BUNDLE: path or inline bundle of trusted public keys/certificates for signature verification

See detailed Runner doc: [runner.md](runner.md)

## Endpoint and UI delivery correctness
- All extension API calls traverse /api/ext/[extensionId]/[...] and are proxied to Runner /v1/execute
- UI assets are served by Runner only, at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]; there is no Next.js route for ext-ui

## References
- [Implementation Plan](implementation_plan.md)
- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Development Guide](development_guide.md)
- [Runner Service](runner.md)
