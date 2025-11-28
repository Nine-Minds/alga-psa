# Extension Security & Signing

This document specifies the v2-only signing, provenance, and isolation model for Enterprise extension bundles. All extensions are published and installed as signed, content-addressed artifacts. Verification is enforced during publish/install and again at load/serve time. Execution occurs out-of-process in the Runner with strict capability and resource policies.

Key integration points:
- Registry v2 for versions, manifests, content hashes, and signatures: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
- Gateway route that proxies extension HTTP calls to Runner: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- UI delivery served by Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`, with iframe initialization via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)

## Principles
- No tenant code runs inside the host app process
- All code executes out-of-process in the Runner under strict limits
- Bundles are immutable, content-addressed (sha256:…) and signed; verified on install and on load
- Capabilities, egress, and quotas are enforced by the Gateway and Runner

## Signed, Content-Addressed Bundles

- Compute SHA256 over the canonical bundle (manifest, WASM, assets)
- Store artifacts in object storage under `sha256/<hash>` paths
- Persist a detached signature alongside registry metadata
- Registry records `content_hash`, `signature`, publisher identity, and optional SBOM reference
- Example content hash format: `sha256:012345...abcd`

## Trust & Verification

- Trust bundle configured via `SIGNING_TRUST_BUNDLE` (PEM), containing accepted publisher certificates/keys
- Verification points:
  1) On publish/install in Registry
  2) On load/serve by the Runner (defense in depth)
- Verification steps:
  - Resolve and load trust anchors
  - Validate signature over the canonical digest for `content_hash`
  - Reject on mismatch, untrusted signer, or invalid chain

## Gateway Policies

- All extension HTTP calls go through `/api/ext/[extensionId]/[[...path]]`
- Gateway resolves tenant install/version and matches the manifest endpoint
- Enforcement at the edge:
  - Request/response size caps (e.g., 5–10 MB)
  - Timeouts via `EXT_GATEWAY_TIMEOUT_MS`
  - Header allowlist (strip end-user `authorization`; inject service-level headers)
  - Per-tenant rate limits and request normalization
- The Gateway proxies to Runner `POST /v1/execute` and maps responses using a safe header allowlist

Reference route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

## Runner Isolation

- Runtime: Wasmtime with pooling allocator and epoch-based timeouts
- Limits: memory/time/fuel per invocation; concurrency caps per tenant/extension
- Capability-scoped Host APIs (`alga.*`):
  - `http.fetch` with egress allowlist (`EXT_EGRESS_ALLOWLIST`)
  - `storage.kv` with tenant/extension scoping
  - `secrets.get` via brokered access; plaintext minimized
  - `log` and `metrics` with structured output and cardinality control
- Response policy: safe header allowlist (`content-type`, safe `cache-control`, custom `x-ext-*`); disallow `set-cookie`

UI security:
- Static UI served by Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
- Iframe sandbox defaults and origin validation in host bootstrap:
  - [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38)
  - [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)

## Quotas & Observability

- Quotas per tenant/extension:
  - Concurrency, rate limits, memory/time/fuel bounds
- Observability:
  - Structured execution logs with correlation IDs (request/tenant/extension/version/content_hash)
  - Metrics (Runner and Gateway):
    - Invocation duration, memory usage, fuel, egress bytes, error counts, timeouts
- Data model alignment (examples):
  - `extension_execution_log`, `extension_quota_usage`

## Environment & Configuration

- Gateway:
  - `RUNNER_BASE_URL` — internal URL used to call Runner `POST /v1/execute`
  - `EXT_GATEWAY_TIMEOUT_MS` — default timeout for gateway→runner calls
- Runner:
  - `RUNNER_PUBLIC_BASE` — public origin used to serve ext-ui assets
  - `SIGNING_TRUST_BUNDLE` — trust anchors (PEM) for signature verification
  - `EXT_EGRESS_ALLOWLIST` — permitted hostnames for `alga.http.fetch`
- Storage:
  - Content-addressed root/prefix for bundle artifacts (e.g., MinIO/S3)

## Failure Modes & Error Mapping

- Signature/Integrity errors:
  - Registry/Runner reject install/load; mark version invalid or serve 502 with safe error
- Timeout/Quota exceeded:
  - Map to 504/429 as appropriate; include `x-request-id`
- Unsupported capability or endpoint mismatch:
  - 403 for capability denial; 404 for endpoint not in manifest
- Oversized payloads or headers:
  - 413 for size limit exceeded; 400 for malformed

## References
- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Registry Implementation](registry_implementation.md)
- Gateway route: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe bootstrap: [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38), [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)
- Registry service scaffold: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
