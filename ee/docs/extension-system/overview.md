# Alga PSA Extension System (Enterprise Overview)

This document specifies the Enterprise Edition (EE) extension architecture. It is a v2-only system featuring out-of-process execution, content-addressed signed bundles, a component-model Runner that executes `componentize-js` artifacts, and iframe-only UI delivery served by the Runner.

## Goals
- No tenant code executes in the core app process
- Per-tenant isolation across compute, storage, and egress
- Signed, content-addressed bundles with verified provenance (sha256:…)
- Capability-based host APIs, quotas, and auditable execution

## Architecture

1) Runner Service (Rust + Wasmtime)
- Executes extension handlers as Wasmtime **components** generated via `componentize-js` + `@alga/extension-runtime`
- Enforces memory/time/concurrency limits
- Exposes a minimal set of namespaced host APIs (alga.*) for storage, http, secrets, logging, and metrics
- Provides additional capability providers (e.g., ui proxy) based on install-scoped grants
- Hosts static UI assets for iframe delivery at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]

2) Registry & Bundles
- Registry stores extensions, versions, and metadata (content_hash, signature, runtime) plus tenant install configuration (`tenant_extension_install_config`) and sealed secret envelopes (`tenant_extension_install_secrets`)
- Bundles are immutable, content-addressed artifacts in object storage
- Signatures are verified on publish/install and on load, against a configured trust bundle

3) API Gateway (Next.js)
- Route: `/api/ext/[extensionId]/[[...path]]`
- Resolves tenant install via [@ee/lib/extensions/installConfig](../../server/src/lib/extensions/installConfig.ts) → version/content hash → config + provider grants → secret envelope
- Proxies requests to Runner `POST /v1/execute` with strict header/size/time policies and quotas, attaching `config`, `providers`, and `secret_envelope` in the body
- Reference scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Manifest endpoint matching is currently **advisory**; see [2025-11-12 plan](../plans/2025-11-12-extension-system-alignment-plan.md#workstream-a-%E2%80%94-gateway--registry) for the decision log.

4) UI Delivery (Iframe-Only, served by Runner)
- Static UI assets are served by the Runner at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]
- The host constructs the iframe src via [buildExtUiSrc()](../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](../../server/src/lib/extensions/ui/iframeBridge.ts:45)
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
1. Client calls `/api/ext/{extensionId}/{...}` in the host app (iframe or API consumer).
2. Gateway resolves the tenant install config (content hash, version, providers, config map, sealed secret envelope).
3. Gateway filters headers/body, assembles `{context, http, limits, config, providers, secret_envelope}`, and calls Runner `POST /v1/execute`.
4. Runner fetches/verifies the component by `content_hash`, decrypts secrets when permitted, executes the handler, and returns `{status, headers, body_b64}`.
5. Gateway maps the response to the client with header allowlists and optional config/secrets version headers.

## Manifest v2 Summary
Manifest v2 is the canonical specification for extensions:
- runtime: e.g., `wasm-js@1` (the `componentize-js` pipeline output)
- capabilities: least-privilege host APIs requested (storage, http, secrets, etc.)
- api.endpoints: declare HTTP entrypoints (used for docs/UX today; enforcement work tracked in [Plan A4](../plans/2025-11-12-extension-system-alignment-plan.md))
- ui.iframe: iframe entry HTML and asset mapping; UI is served by Runner using content-addressed paths
- ui.hooks: host integration points such as adding menu entries that launch a full-page iframe; designed to expand for tabs and named placeholders
- precompiled and assets: bundle metadata including sha256 content hash and signatures

See full schema: [manifest_schema.md](manifest_schema.md)

## Security Highlights
- No dynamic importing of tenant JS into the host
- Capability-based host API; deny-by-default egress
- Signature verification and content hashing across the bundle lifecycle
- Iframe sandboxing and origin validation aligned with RUNNER_PUBLIC_BASE

## Runner: responsibilities and integration
The Runner is the execution and static asset host for the EE architecture:
- Executes WASM components out-of-process with isolation and quotas (Rust + Wasmtime Component APIs)
- Hosts static UI assets by immutable content hash; the host builds iframe src via [buildExtUiSrc()](../../server/src/lib/extensions/ui/iframeBridge.ts:38) and initializes via [bootstrapIframe()](../../server/src/lib/extensions/ui/iframeBridge.ts:45)
- Provides HTTP interface for handler execution (`POST /v1/execute`) called by the API Gateway. Gateway scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Implements host capabilities including HTTP egress, storage KV, secrets, logging, metrics, and the UI proxy (`alga.ui_proxy`) with enforcement driven by install-level providers.
- Emits live debug events to Redis Streams when `RUNNER_DEBUG_REDIS_URL` is configured; EE consumes these via `/api/ext-debug/stream`.
- Signature and provenance enforcement integrate with Registry v2 services. Registry scaffold: [ExtensionRegistryServiceV2](../../server/src/lib/extensions/registry-v2.ts:48)

Runner-related configuration (host environment):
- `RUNNER_BASE_URL`: internal URL used by the Gateway to call POST /v1/execute
- `RUNNER_PUBLIC_BASE`: public base used to construct ext-ui iframe src
- `EXT_GATEWAY_TIMEOUT_MS`: gateway → runner request timeout
- `SIGNING_TRUST_BUNDLE`: path or inline bundle of trusted public keys/certificates for signature verification
- `RUNNER_DEBUG_REDIS_URL`, `RUNNER_DEBUG_REDIS_STREAM_PREFIX`, `RUNNER_DEBUG_REDIS_MAXLEN`: enable Redis-backed debug streaming
- `UI_PROXY_BASE_URL`, `UI_PROXY_AUTH_KEY`, `UI_PROXY_TIMEOUT_MS`: configure the runner-side UI proxy capability

See detailed Runner doc: [runner.md](runner.md)

## Endpoint and UI delivery correctness
- All extension API calls traverse `/api/ext/[extensionId]/[[...path]]` and are proxied to Runner `/v1/execute`. Enforcement of manifest endpoint lists is TBD (see [plan](../plans/2025-11-12-extension-system-alignment-plan.md)).
- UI assets are served by Runner only, at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]; there is no Next.js route for ext-ui

## Live Debugging
- Runner emits structured `ExtDebugEvent` entries (stdout/stderr/log) into Redis Streams when debug streaming is enabled.
- EE exposes `/api/ext-debug/stream` (Server-Sent Events) and a UI at `/msp/extensions/[extensionId]/debug` to authorized tenant operators.
- Capability gating, session TTLs, and audit logging are tracked in [Workstream B](../plans/2025-11-12-extension-system-alignment-plan.md#workstream-b-%E2%80%94-runner--debug-stream).

## References
- [Implementation Plan](implementation_plan.md)
- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Development Guide](development_guide.md)
- [Runner Service](runner.md)
