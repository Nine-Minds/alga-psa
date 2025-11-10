# Extension Runner (EE)

This document explains the Extension Runner’s role in the Enterprise Extension System and how it integrates with the Gateway, Registry, signing, and UI delivery.

References:
- Runner project (Rust): [ee/runner/Cargo.toml](ee/runner/Cargo.toml)
- Iframe bootstrap and URL builder in host UI: [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45), [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38)
- Registry v2 service (types and scaffold): [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
- Gateway handler (spec-aligned scaffold): [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)

## Purpose and responsibilities

- Execute extension server handlers as out-of-process WASM modules with strict isolation.
- Serve static UI assets for extensions by immutable content hash (content-addressed).
- Enforce capability-based host APIs and guardrails (quotas, timeouts, egress policies).
- Provide a stable HTTP interface for the Gateway to invoke extension handlers.
- Maintain a pod-local cache of verified bundles for performance and reliability.

## High-level architecture

- Process and runtime: Rust + Wasmtime (WASI).
  - Wasmtime is used to load/execute precompiled or interpreted WASM modules with resource limits.
- HTTP server: Axum + Tower layers (tracing, headers, static files), see dependencies in [ee/runner/Cargo.toml](ee/runner/Cargo.toml).
- Storage and caching:
  - Immutable content-addressed bundles (tar/zstd or similar) stored in object storage.
  - Pod-local cache keyed by content hash for hot assets and module bytes.
- Security:
  - Signature verification at publish/install (via Registry) and prior to execution/load.
  - Capability-based host API; deny-by-default for egress and privileged operations.
  - Strict header and size limits on inbound/outbound HTTP.

## Interfaces

### 1) Execute endpoint (Runner)

- HTTP: `POST /v1/execute`
- Caller: Gateway
- Request (example):
```json
{
  "context": {
    "request_id": "3d2c3f27-5b9c-4ad0-90f5-4c5ec8e844be",
    "tenant_id": "tenant-123",
    "extension_id": "com.example.sales",
    "version_id": "ver_abc123",
    "content_hash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
  },
  "endpoint": "dist/handlers/http/sync",
  "http": {
    "method": "POST",
    "path": "/agreements/sync",
    "query": { "force": "true" },
    "headers": {
      "x-request-id": "3d2c3f27-5b9c-4ad0-90f5-4c5ec8e844be",
      "x-alga-tenant": "tenant-123",
      "x-alga-extension": "com.example.sales",
      "content-type": "application/json"
    },
    "body_b64": "eyAiZm9vIjogImJhciIgfQ=="
  },
  "limits": {
    "timeout_ms": 5000
  }
}
```
- Response (example):
```json
{
  "status": 200,
  "headers": {
    "content-type": "application/json",
    "x-ext-request-id": "3d2c3f27-5b9c-4ad0-90f5-4c5ec8e844be"
  },
  "body_b64": "eyAic3RhdHVzIjogIm9rIiB9"
}
```
- The Gateway normalizes the inbound Next.js request and forwards a minimal envelope. See gateway scaffolding at [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts).

### 2) Static UI asset hosting (Runner)

- Purpose: Serve iframe UI assets for a given extension by content hash.
- URL shape (recommended):
  - `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
- Behavior:
  - Content-addressed path ensures immutability. Set `Cache-Control: public, max-age=31536000, immutable`.
  - Assets validated (existence and content hash) before serving.
  - MIME type is derived safely (e.g., via `mime_guess`); only static file types served.
- Host bootstrap:
  - The host uses [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) to construct the iframe URL for the Runner’s public base and [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45) to perform the secure initialization (sandbox, origin checks, postMessage protocol).

## Execution model

- Module resolution:
  - `version_id` → fetch manifest → resolve `endpoint.handler` path → load WASM (precompiled preferred) from content-addressed storage.
- Isolation and limits:
  - Memory/time/fuel limits enforced per invocation (configurable).
  - Concurrency controls per tenant/extension (global caps, per-request rate limits).
- Capability-based host APIs (examples):
  - `http.fetch` with tenant/extension egress allowlists.
  - `storage.kv` with tenant-namespaced keys.
  - `secrets.get` returning handles/tokens; plaintext minimized.
  - `log` and `metrics` emitting structured events and counters/histograms.

## Security and signing

- Content-addressed bundles:
  - Hash: `sha256:<hex64>`.
  - Bundles contain `manifest.json` (v2), `dist/` (WASM handlers), `ui/` (static assets), and optional `precompiled` artifacts.
- Signatures:
  - Detached signature persisted alongside bundle metadata.
  - Verification occurs on publish/install and before load/serve.
  - Trust roots provisioned via Runner/Registry environment (e.g., PEM chain).
- Origin and iframe safety:
  - The host enforces sandbox defaults (`allow-scripts`, no implicit `allow-same-origin`) and validates target origins in the bootstrap flow (see [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)).
- Header policy:
  - Gateway strips end-user `authorization` and injects service-level headers (`x-request-id`, tenant/extension IDs).
  - Runner enforces response header allowlist (`content-type`, safe `cache-control`, custom `x-ext-*`).

## Configuration (env)

- `RUNNER_BACKEND`: Selects `knative` (default) or `docker` backend for the gateway.
- `RUNNER_BASE_URL`: Gateway’s internal URL to call Runner (e.g., `http://runner:8080`).
- `RUNNER_DOCKER_HOST`: Override Runner base URL when using the Docker backend (e.g., `http://localhost:8085`).
- `RUNNER_PUBLIC_BASE`: Public base used in iframe src for UI assets. Accepts absolute URLs or relative paths (e.g., `/runner`) when the gateway proxies Runner assets.
- `EXT_GATEWAY_TIMEOUT_MS`: Gateway-side invocation timeout (Runner should also have server-side timeouts).
- `SIGNING_TRUST_BUNDLE`: Path or value for trusted publisher certificates/keys.
- `BUNDLE_STORAGE_*`: Object storage configuration for content-addressed bundle retrieval (S3 or equivalent, if used).
- `REGISTRY_BASE_URL`: Base URL of the EE server for registry lookups (e.g., `https://algapsa.com`).
- `ALGA_AUTH_KEY`: Service API key used by the Runner when calling the EE registry endpoints. The Runner sends this as `x-api-key` for `/api/installs/lookup-by-host` and `/api/installs/validate`.

## Gateway → Runner flow (summary)

1. Client calls host `/api/ext/{extensionId}/{...}`.
2. Gateway resolves tenant install → `version_id` → `content_hash` → manifest endpoint.
3. Gateway builds normalized request and `POST /v1/execute` to Runner with timeouts and service auth.
4. Runner executes the handler in a sandbox and returns `{status, headers, body_b64}`.
5. Gateway returns filtered headers/body to the client.

## Observability

- Structured logs per request with correlation IDs.
- Metrics exposed by Runner:
  - Invocation duration, memory usage, fuel, egress bytes, error counts.
- Execution logs persisted via Registry or a logging backend keyed by tenant/extension.

## Local development

- Run Runner locally (Cargo) and point the host `RUNNER_BASE_URL` to it.
- Use `RUNNER_PUBLIC_BASE` to serve UI assets directly from Runner’s static asset host.
- During early development of UI, authors may serve assets via a local dev server, but production must use content-addressed assets hosted by Runner.

## Error mapping (guidance)

- 404: Unknown endpoint in manifest or missing asset (by content hash/path).
- 413: Request/response size exceeded configured limits.
- 502: Runner internal error or non-OK upstream.
- 504: Timeout reached (Gateway or Runner).
- Always include `x-request-id` and `x-ext-*` headers where appropriate.

## Registry integration

- The Runner relies on Registry to supply metadata: versions, manifests, content hashes, and signatures (publish/install workflows).
- See [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48) for service scaffolding used by the Gateway and Registry layer.
