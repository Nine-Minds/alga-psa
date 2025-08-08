# Client Extension Multi-Tenancy Overhaul Plan

Last updated: 2025-08-08

## Context & Findings

- Current behavior: user-supplied extension code is uploaded into the running application environment and dynamically loaded. This violates multi-tenant isolation and increases operational risk (code execution in app context, shared process memory, filesystem access, and unrestricted egress).
- Repo state: Community Edition (CE) contains stubs; Enterprise Edition (EE) code is present under `ee/server`. The CE app dynamically imports EE initialization (`ee/server/src/lib/extensions/initialize`) when enterprise mode is enabled.
- Risk summary:
  - Cross-tenant impact via shared process or host resources.
  - In-process arbitrary code execution elevates the blast radius to the entire cluster.
  - Unbounded capabilities: filesystem, network, and secrets likely not capability-scoped.
  - Weak provenance: uploaded files lack signed, reproducible artifacts and verified dependency graphs.

## Goals

- Strong tenant isolation for compute, storage, cache, and network.
- No direct execution of tenant-supplied code in the application process.
- Capability-based, least-privilege runtime with explicit allowlists.
- Deterministic, reproducible, and signed extension artifacts.
- Auditable execution with traceability, quotas, and rate limits per tenant.
- Backwards-compatible migration path, with clear deprecation of unsafe paths.

## Non-Goals (for this overhaul)

- Supporting all languages. Start with JS/TS to WASM or isolate; consider additional languages later.
- Full “bring-your-own container” marketplace. We will support a controlled out-of-process path, but not arbitrary images at first.

## Upfront Decisions (Simplifications)

- EE-only: Extensions ship only with Enterprise Edition; no feature flag toggle needed in CE. Remove extension initialization paths in non-EE builds.
- Runtime: Standardize on Wasmtime-based wasm_runner only; no alternate runtimes.
- Storage: Use S3-compatible storage via our existing S3StorageProvider against local MinIO only. No alternative providers. Canonical bucket and prefix are defined via env.
- UI: Iframe-only Client SDK approach. React-based example and docs only for SDK; no descriptor renderer.
- Fetch/serve model: Object storage is source of truth. Pods fetch bundles/UI on-demand into a pod-local cache and serve directly via Next.js/Knative.
## Phased TODO (Implementation Plan)

Phase 0 — Foundations and Switches
- [ ] EE-only wiring: ensure extension initialization is only imported in EE builds (confirm in `server/src/lib/initializeApp.ts` and aliases). Remove/ignore extensions in CE.
- [ ] Env/config (MinIO + cache + runner): document and template in `.env` and `ee/server/.env.example`:
  - `EXT_BUNDLE_STORE_URL=http://minio:9000/alga-extensions` (or bucket + endpoint vars)
  - `STORAGE_S3_ENDPOINT=http://minio:9000`
  - `STORAGE_S3_ACCESS_KEY=alga`
  - `STORAGE_S3_SECRET_KEY=alga-secret`
  - `STORAGE_S3_BUCKET=alga-extensions`
  - `STORAGE_S3_REGION=us-east-1`
  - `STORAGE_S3_FORCE_PATH_STYLE=true`
  - `EXT_CACHE_ROOT=/var/cache/alga-ext`
  - `RUNNER_BASE_URL=http://alga-ext-runner.default.svc.cluster.local`
- [ ] Draft Manifest v2 JSON Schema at `ee/docs/schemas/extension-manifest.v2.schema.json` and example bundle layout at `ee/docs/examples/extension-bundle-v2/`.

Phase 1 — Database Schema and Registry Services
- [ ] Migrations (EE): add files under `ee/server/migrations/`:
  - `[2025xxxx01]_create_extension_registry.cjs`
  - `[2025xxxx02]_create_extension_version.cjs`
  - `[2025xxxx03]_create_extension_bundle.cjs`
  - `[2025xxxx04]_create_tenant_extension_install.cjs`
  - `[2025xxxx05]_create_extension_event_subscription.cjs`
  - `[2025xxxx06]_create_extension_execution_log.cjs`
  - `[2025xxxx07]_create_extension_quota_usage.cjs`
  - Ensure RLS: tables keyed by `tenant_id` enforce row-level security in queries.
- [ ] Registry service (TS) in `ee/server/src/lib/extensions/registry-v2.ts`:
  - create/list/get registry entries; add versions with `content_hash`, `signature`, `runtime`, `precompiled`, `api.endpoints`, `ui` block.
- [ ] Tenant install service in `ee/server/src/lib/extensions/install-v2.ts`:
  - install/uninstall/enable/disable; persist `granted_caps`, `config`, `version_id`.
- [ ] Signature verification util in `server/src/lib/extensions/signing.ts`:
  - load trust bundle from `SIGNING_TRUST_BUNDLE` (PEM); verify bundle signature + content hash.
- [ ] (Optional) Admin CLI: `server/scripts/ext-registry.ts` for publish/deprecate/install management.

Phase 2 — Bundle Storage Integration
- [ ] Use existing S3StorageProvider (EE) at `ee/server/src/lib/storage/providers/S3StorageProvider.ts` for object access against MinIO.
- [ ] Implement `server/src/lib/extensions/bundles.ts`:
  - `getBundleStream(contentHash)`, `getBundleIndex(contentHash)`, `extractSubtree(contentHash, subtree, dest)` for `dist/` and `ui/`.
- [ ] Support optional precompiled Wasmtime artifacts (cwasm) stored adjacent to raw WASM; index by target triple in `extension_bundle`.

Phase 3 — Runner Service (Rust + Wasmtime)
- [ ] Scaffold `ee/runner/` crate:
  - `Cargo.toml`, `src/main.rs`, `src/http/server.rs` (`POST /v1/execute`), `src/models.rs`.
  - Engine: `src/engine/mod.rs`, `src/engine/host_api.rs`, `src/engine/loader.rs`.
  - Cache: `src/cache/lru.rs` using content-hash keyed files under `EXT_CACHE_ROOT`.
- [ ] Configure Wasmtime: pooling allocator; Store limits (mem/table); epoch-based timeout; optional fuel metering.
- [ ] Host imports `alga.*` in `host_api.rs`:
  - `alga.storage.get/set/delete/list`, `alga.http.fetch` (respect egress allowlist), `alga.secrets.get`, `alga.log.info/warn/error`, `alga.metrics.emit`.
- [ ] Module fetch/cache: pull WASM/cwasm by `content_hash` from MinIO via S3 provider; verify signature; cache LRU under `EXT_CACHE_ROOT`.
- [ ] Execute flow: validate request; instantiate; call handler; marshal `{status, headers, body_b64}`; enforce limits; write `extension_execution_log`.
- [ ] Errors: standardized codes (timeout, memory_limit, quota_exceeded, bad_handler, internal); unit/integration tests.
- [ ] Containerization: `ee/runner/Dockerfile`; KService YAML `ee/runner/deploy/runner.kservice.yaml` (containerConcurrency, target concurrency, minScale).

Phase 4 — Next.js API Gateway for Server-Side Handlers
- [ ] Add `server/src/app/api/ext/[extensionId]/[...path]/route.ts` supporting GET/POST/PUT/PATCH/DELETE.
- [ ] Helpers in `server/src/lib/extensions/gateway/`:
  - `auth.ts`: `getTenantFromAuth(req)`; `assertAccess(tenantId, extensionId, method, path)`
  - `registry.ts`: `getTenantInstall()`, `resolveVersion()`
  - `endpoints.ts`: route matcher for manifest `api.endpoints` with path params
  - `headers.ts`: `filterRequestHeaders()`, `filterResponseHeaders()`
- [ ] Implement header policy (forward allowlist; strip end-user `authorization`), body size caps, and timeout (`EXT_GATEWAY_TIMEOUT_MS`).
- [ ] Proxy to Runner `/v1/execute` with service token; map response back to client; emit telemetry.

Phase 5 — Client Asset Fetch-and-Serve (Pod-Local Cache)
- [ ] Add `server/src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts` (GET) to serve iframe apps.
- [ ] Cache manager in `server/src/lib/extensions/assets/cache.ts`:
  - Ensure `<EXT_CACHE_ROOT>/<contentHash>/ui/` exists; else fetch bundle and extract `ui/**/*`.
  - LRU index persisted at `<EXT_CACHE_ROOT>/_index.json`; evict by size (1–2 GB default).
- [ ] Static serve helper in `server/src/lib/extensions/assets/serve.ts`:
  - Serve file with SPA fallback to `index.html`; sanitize paths; set `Cache-Control: public, max-age=31536000, immutable`, `ETag`, `Content-Type`.
- [ ] Mime map at `server/src/lib/extensions/assets/mime.ts`.

Phase 6 — Client SDK (Iframe)
- [ ] New packages under repo root:
  - `packages/extension-iframe-sdk/`
  - `packages/ui-kit/`
- [ ] `packages/extension-iframe-sdk` files:
  - `src/index.ts`: SDK entry; handshake and message bus (postMessage)
  - `src/bridge.ts`: message protocol types and handlers (events: `init`, `theme`, `auth`, `navigate`, `telemetry`, `resize`)
  - `src/auth.ts`: retrieve scoped token from host via bridge
  - `src/navigation.ts`: push/replace navigation events (host-managed routing)
  - `src/theme.ts`: apply CSS variables from host; subscribe to theme changes
  - `src/types.ts`: TypeScript interfaces for messages and context
  - `README.md`: usage docs with React example
- [ ] `packages/ui-kit` files:
  - `src/index.ts`
  - `src/theme/tokens.css` (CSS variables), `src/theme/index.ts`
  - Components (React + Tailwind, a11y-first):
    - Buttons: `Button.tsx`, `IconButton.tsx`, `LinkButton.tsx`
    - Inputs: `TextField.tsx`, `TextArea.tsx`, `NumberField.tsx`, `Select.tsx`, `MultiSelect.tsx`, `DatePicker.tsx`, `DateRangePicker.tsx`, `Checkbox.tsx`, `Switch.tsx`, `RadioGroup.tsx`, `FileInput.tsx`
    - Layout: `Card.tsx`, `Panel.tsx`, `Grid.tsx`, `Stack.tsx`, `Tabs.tsx`, `Toolbar.tsx`, `Modal.tsx`, `Drawer.tsx`
    - Data display: `Table.tsx` (columns, sort, paginate), `Badge.tsx`, `Tag.tsx`, `Tooltip.tsx`, `Avatar.tsx`, `Skeleton.tsx`, `EmptyState.tsx`
    - Feedback: `Toast.tsx`, `Alert.tsx`, `Spinner.tsx`, `ProgressBar.tsx`
  - `src/hooks/useForm.ts` (React Hook Form integration), `src/hooks/useToast.ts`
  - `README.md` with prop tables and code samples
- [ ] Starter app template at `examples/extension-react-app/` (Vite + TS), using SDK and UI Kit; includes router, auth hook, and sample pages.
- [ ] Host bridge bootstrap in `server/src/lib/extensions/ui/iframeBridge.ts` to inject theme tokens and session into iframe on load.

Phase 7 — Knative Serving (Runner)
- [ ] Create KService manifest for Runner with annotations: concurrency metric/target, `containerConcurrency`, `minScale`/`maxScale`.
- [ ] Implement `/healthz` and `/warmup` endpoints; prefetch hot bundles on warmup.
- [ ] Add CI/CD step to deploy Runner revision and smoke-test `/v1/execute` with a hello-world module.

Phase 8 — EE Code Migration (remove legacy paths)
- [ ] Remove/feature-flag `ee/server/src/lib/extensions/initialize.ts` filesystem scan of `process.cwd()/extensions`.
- [ ] Remove/detour `ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx` dynamic import logic; update UI to iframe embedding using `/ext-ui/{extensionId}/{content_hash}/index.html`.
- [ ] Replace `installExtension` action to install from Registry (select version) instead of uploading files to server.
- [ ] Update settings and details pages to reflect per-tenant installs, versions, and capabilities; add “Open Extension” buttons that navigate to iframe routes.

Phase 9 — Security, Quotas, and Policy
- [ ] Enforce capability grants at install time; block Runner host imports for missing capabilities.
- [ ] Implement egress allowlist per tenant/extension for `http.fetch`.
- [ ] Integrate secret manager for `secrets.get` (no plaintext storage); rotate tokens.
- [ ] Add per-tenant/per-extension execution quotas (concurrency and rate) in gateway and Runner.

Phase 10 — Observability and Ops
- [ ] Emit structured execution logs with correlation IDs; persist to `extension_execution_log`.
- [ ] Expose Prometheus metrics from Runner (duration, memory, fuel, egress bytes, errors).
- [ ] Add dashboards and alerts for failure rates, timeouts, and resource breaches.

Phase 11 — Docs, Samples, and Pilot
- [ ] Write developer docs: manifest v2, building bundles, publishing, installing, and iframe app development.
- [ ] Provide a full sample extension (server handlers + iframe UI) using the new system.
- [ ] Pilot with a partner tenant; validate SLOs and collect feedback for iteration.

## Proposed Architecture

WASM-only runner model:

1) Out-of-Process Runner (single runtime path)
- Execute all extensions in an external Runner Service using a WASM runtime with a strict, capability-based Host API.
- No direct filesystem access; no raw network access. All I/O occurs through brokered host functions that enforce tenant- and capability-scoped policies.
- Deterministic execution with configurable timeouts, memory limits, and concurrency controls per tenant/extension.

2) Signed, Reproducible Bundles
- Extensions are packaged as immutable bundles (content-addressed by SHA256) with a manifest and lockfile.
- Build pipeline compiles/transpiles and freezes dependencies; no dynamic require/import at runtime.
- Bundles stored in object storage (e.g., S3/GCS) and verified by signature on install and on load.

3) Capability-Based Host API (stable, versioned)
- Minimal surface: events, HTTP fetch via broker, key-value/doc store, scheduled tasks, secrets, and logging/metrics.
- Explicit grants recorded per tenant install (manifest + admin approvals). All calls carry `tenant_id` and `extension_id`.
- Timeouts, memory/cpu quotas, and concurrency limits enforced by the runner.

4) Event-Driven Execution
- Core app publishes events (domain, data changes, schedules) to an event bus.
- Registry maps tenant subscriptions to installed extension entrypoints.
- Runner pulls events, resolves bundle, executes handler in isolated sandbox, and reports result/metrics.

5) UI Extension Sandboxing
- UI integrates exclusively via sandboxed iframes powered by the Alga Extension Client SDK.
- Enforce strict CSP, postMessage bridge, and explicit allowlists for APIs and assets.
- UI assets are served from signed bundles or CDN; no runtime code injection into the host app.

### Components
- Extension Registry: catalogs extensions, versions, capabilities, and maintainers.
- Tenant Install Store: per-tenant install with granted capabilities, secrets, and config.
- Bundle Storage: object storage for signed, content-addressed bundles.
- Build Service: validates, compiles, and signs bundles (CI-integrated and/or hosted).
- Runner Service: isolated execution engine with quotas, metrics, and audit logs (implemented with Wasmtime).
- Host API Broker: mediates storage, network egress, secrets, and queues; enforces policy.
- Event Bus: routes events and schedules executions.
- UI Host: renders UI extensions using sandbox constraints.

### Distributed Bundles, Assets, and Caching (multi-pod safe)
- Object storage as source of truth: All extension bundles and UI assets live in object storage using content-addressed paths (`sha256/<hash>`). No persistent host volumes across pods.
- Pod-local caches: Runner and API pods maintain small ephemeral LRU caches on local disk/memory. On first request for a given `content_hash`, the pod pulls only the needed artifacts (WASM and/or `ui/**/*`) into its local cache.
- Optional prefetch: On pod startup or install/upgrade events, selectively prefetch hot bundles/UI to reduce first-request latency.
- No app-managed CDN or signed URLs: Assets are served directly from the pod over Knative Serving once cached locally.
- Precompiled module cache: Store optional precompiled Wasmtime artifacts in object storage; pods fetch on demand and keep an ephemeral cache per target triple. Validate hash on use.
- GC policy: Capacity-based eviction (e.g., max N GB or file count) with background GC to remove least-recently-used artifacts.
- Consistency & integrity: Content-hash directory layout ensures deterministic assets. Verify signatures for bundles before use; verify file hashes when extracting.

### Runner Service Design (Rust + Wasmtime)
- Embedding: Rust service embedding Wasmtime with PoolingAllocator; Store limits configured for memory/tables.
- Invocation API: Internal gRPC/HTTP accepting `tenant_id`, `extension_id`, `version_id`, `content_hash`, `entry`, `input`, and idempotency key. Runner fetches module artifacts, verifies signature, instantiates, and executes.
- Host imports (capabilities): Namespaced imports `alga.*` for storage, http, secrets, events, logging. All calls scope to tenant/extension and enforce quotas and egress policy. No preopened FS; no ambient WASI.
- Resource controls: Per-invocation memory caps, epoch timeouts, optional fuel metering; concurrency throttles per tenant/extension. Hard stop on policy violations with structured errors.
- Event integration: Pull from event bus/queue with per-tenant partitions; support push-based execution for admin test-runs.
- Observability: Structured logs with correlation IDs, metrics (duration, mem, fuel, egress), and tracing.
- Failure handling: Retries via idempotency; quarantine misbehaving extensions; circuit breakers for upstream/broker failures.

### Client UI Delivery (iframe-only with SDK)
- Iframe-only UI: Extensions ship prebuilt static apps (e.g., React/Vite build). On first request, the API pod pulls the `ui/**/*` subtree for the installed `content_hash` into a pod-local cache and serves assets directly.
- Client SDK: Provide `@alga/ui-kit` and `@alga/extension-iframe-sdk` for consistent components, theming, a11y, and a postMessage bridge (auth, navigation, theme tokens, telemetry, viewport sizing).
- Theming: Host propagates design tokens to the iframe via the bridge; UI Kit consumes CSS variables for live theme updates.
- Security: Sandbox iframes (`allow-scripts` by default; add `allow-same-origin` only if needed by SDK). All API calls go through `/api/ext/...` gateway. Prevent directory traversal in asset serving.

### Client Asset Serving via Gateway (pod-local cache)
- Entry route: `src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts` (GET)
  - Resolves tenant install → `content_hash` (the URL’s `[contentHash]` must match; otherwise 404) to avoid serving stale assets.
  - Ensures `ui/**/*` for `[contentHash]` exists in the pod-local cache directory, otherwise pulls and extracts just the `ui` subtree from the bundle archive.
  - Serves files from `<CACHE_ROOT>/<contentHash>/ui/` with SPA fallback to `index.html` when `path` is missing or not found.
  - Sets headers: `Cache-Control: public, max-age=31536000, immutable` because `contentHash` makes URLs immutable; adds `ETag` based on file hash; sets content-type by extension.
- Iframe src: Host pages set iframe `src="/ext-ui/{extensionId}/{content_hash}/index.html?path=/desired/route"`.
- Safety: Sanitize path, disallow `..` segments, and restrict to the cached directory. Limit individual file size and total cache size.

### Knative Serving Profile (initial)
- Serving only (no Eventing initially). The Runner ships as a Knative Service (KService) to leverage revisioning and concurrency-based autoscaling.
- Autoscaling metric: concurrency. Configure `containerConcurrency` (e.g., 4–16 depending on per-invocation memory) and use the Knative Pod Autoscaler (KPA) with a simple target concurrency (e.g., 10) as a starting point. Final SLOs/policies to be tuned later.
- Scale policy: keep `minScale` configurable (0 for non-critical, 1+ for production to reduce cold starts). Set `maxScale` to cap cost. Revisions roll out runner code safely; extension versions are handled at the bundle layer, not via Knative revisions.
- Probes and warmup: add a warmup endpoint to prefetch common bundles and initialize Wasmtime; use readiness probes that succeed only after caches are primed if needed.
- Security: run under a restricted ServiceAccount with egress policies; use Kubernetes secrets for broker credentials and object store credentials.

Example KService (abridged):
```
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: alga-ext-runner
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/metric: concurrency
        autoscaling.knative.dev/target: "10"
        # Optional, tune later
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "50"
    spec:
      containerConcurrency: 8
      containers:
        - image: ghcr.io/alga/runner:sha-<image>
          env:
            - name: BUNDLE_STORE_BASE
              value: https://s3.example.com/alga-ext/
            - name: SIGNING_TRUST_BUNDLE
              valueFrom:
                secretKeyRef: { name: runner-secrets, key: trust.pem }
            - name: RUNTIME_LIMITS
              value: '{"memory_mb":512,"timeout_ms":5000,"fuel":null}'
          ports:
            - containerPort: 8080
```

### On-Demand Loading, Versioning, and Hot Swap
- Lazy load: Resolve the tenant’s installed extension version on each request; fetch the bundle by `content_hash` from object storage if not cached; verify signature; instantiate per-invocation.
- Caching: Maintain in-pod LRU caches for raw WASM and precompiled artifacts keyed by `content_hash+target`. Validate hashes on every use. Optionally cache resolved handler maps per extension version.
- Version updates: Tenant install updates change the `version_id → content_hash` mapping in the registry. Subsequent requests pick up the new `content_hash` automatically (cache miss → fetch new). In-flight requests continue on the old version; no pod restarts required.
- Warmup: On install/upgrade, optionally push a warmup signal to prefetch and precompile hot bundles on a subset of Runner pods.
- Consistency: Use strong consistency on registry lookups or include `content_hash` in the gateway’s dispatch token so the Runner executes the intended version even amid concurrent upgrades.

### HTTP Routing for Plugin Endpoints
- Gateway pattern: The core app exposes stable API paths and forwards plugin requests to the Runner. Proposed pattern: `/api/ext/{extensionId}/{...path}` with tenant context inferred from auth/session.
- Manifest mapping: Manifest v2 defines API endpoints (method, path template, handler). The gateway resolves `{extensionId, method, path}` to a handler name within the bundle and calls Runner Execute with the request payload and headers.
- AuthZ and quotas: The gateway enforces user authN/RBAC and per-tenant rate limits before invoking Runner. The Runner still enforces capability-level checks and per-tenant execution quotas.
 - Contract: Runner HTTP execute endpoint accepts `method`, `path`, `query`, `headers`, and `body` plus context (tenant_id, extension_id, content_hash), returning `status`, `headers`, and `body`. Inside WASM, the handler receives a normalized request object and returns a normalized response.

### Next.js API Router/Proxy (design)
- Route structure: `src/app/api/ext/[extensionId]/[...path]/route.ts`
- Methods: Support GET, POST, PUT, PATCH, DELETE. All methods follow the same pipeline.
- Env/config: `RUNNER_BASE_URL`, `BUNDLE_STORE_BASE`, `SIGNING_TRUST_BUNDLE`, `EXT_GATEWAY_TIMEOUT_MS`.

Request pipeline (per request):
- Resolve tenant: derive `tenant_id` from session/auth; attach to context and rate-limit bucket.
- Resolve install/version: query registry for tenant’s install of `extensionId`; get `version_id` and `content_hash`.
- Resolve endpoint: load manifest for that version (from registry/bundle manifest cache) and match `{method, path}` against `api.endpoints` (support path params). If not found, return 404.
- Build Execute call: construct a request for Runner with context and normalized HTTP payload. Generate an idempotency key for non-GET from `request_id || hash(method+url+body)`.
- Forward to Runner: call `POST {RUNNER_BASE_URL}/v1/execute` with a short-lived service token. Propagate an allowlist of headers (e.g., `x-request-id`, `accept`, `content-type`) and strip end-user `authorization`.
- Timeout & retries: apply `EXT_GATEWAY_TIMEOUT_MS` (default 5s). Retries only on 502/503/504 with jitter and idempotency for safe methods.
- Return response: map Runner’s `{status, headers, body}` to `NextResponse`. Enforce response header allowlist and size limits.

Execute API (Runner)
- Request JSON (abridged):
```
{
  "context": {
    "request_id": "uuid",
    "tenant_id": "t_123",
    "extension_id": "com.alga.softwareone",
    "content_hash": "sha256:...",
    "version_id": "ver_abc"
  },
  "http": {
    "method": "POST",
    "path": "/agreements/sync",
    "query": { "force": "true" },
    "headers": { "content-type": "application/json" },
    "body_b64": "eyJwYXlsb2FkIjoiLi4uIn0="
  },
  "limits": { "timeout_ms": 5000, "memory_mb": 256 }
}
```
- Response JSON (abridged):
```
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body_b64": "eyJyZXN1bHQiOiJPSyJ9"
}
```

Header policy (allowlist / strip):
- Forward: `x-request-id`, `accept`, `content-type`, `accept-encoding`, `user-agent` (normalized), `x-alga-tenant` (added by gateway), `x-alga-extension` (added), `x-idempotency-key` (generated for non-GET).
- Strip: `authorization` from end-user; gateway authenticates user and injects a service credential to Runner.
- Response: allow `content-type`, `cache-control` (if safe), custom `x-` headers under `x-ext-*`. Disallow `set-cookie` and hop-by-hop headers.

Security and limits:
- RBAC: verify user can access the extension/endpoint before proxying.
- Quotas: apply per-tenant rate limit and concurrency caps at the gateway; Runner enforces execution quotas.
- Size: cap request/response body (e.g., 5–10 MB) with clear 413/502 handling.
- Timeouts: default 5s; allow per-endpoint overrides with safe maximums (e.g., 30s).

Example Next.js handler (abridged):
```
// src/app/api/ext/[extensionId]/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function handler(req: NextRequest, ctx: { params: { extensionId: string; path: string[] } }) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const method = req.method;
  const { extensionId, path } = ctx.params;
  const pathname = '/' + (path || []).join('/');
  const url = new URL(req.url);

  const tenantId = await getTenantFromAuth(req);
  await assertAccess(tenantId, extensionId, method, pathname);

  const install = await getTenantInstall(tenantId, extensionId);
  if (!install) return NextResponse.json({ error: 'Not installed' }, { status: 404 });
  const { version_id, content_hash } = await resolveVersion(install);

  const endpoint = await resolveEndpoint(version_id, method, pathname);
  if (!endpoint) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
  const execReq = {
    context: { request_id: requestId, tenant_id: tenantId, extension_id: extensionId, content_hash, version_id },
    http: {
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: filterHeaders(req.headers),
      body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined
    },
    limits: { timeout_ms: Number(process.env.EXT_GATEWAY_TIMEOUT_MS) || 5000 }
  };

  const runnerResp = await fetch(`${process.env.RUNNER_BASE_URL}/v1/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      'authorization': await getRunnerServiceToken()
    },
    body: JSON.stringify(execReq),
    signal: AbortSignal.timeout(Number(process.env.EXT_GATEWAY_TIMEOUT_MS) || 5000)
  });

  if (!runnerResp.ok) {
    return NextResponse.json({ error: 'Runner error' }, { status: 502 });
  }
  const { status, headers, body_b64 } = await runnerResp.json();
  const resHeaders = filterResponseHeaders(headers);
  const body = body_b64 ? Buffer.from(body_b64, 'base64') : undefined;
  return new NextResponse(body, { status, headers: resHeaders });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

## Runtime Decision: Wasmtime (WASM-only)

- Choice: Use Wasmtime as the sole runtime for executing extensions as WebAssembly modules.
- Rationale (enterprise maturity):
  - Backed by the Bytecode Alliance with a strong track record, multiple independent security audits, and responsive CVE handling.
  - Production adoption across vendors; frequent releases; stable WASI Preview 1 support and growing Preview 2/component-model support.
  - Rich security controls: memory limits, epoch-based interruption/timeouts, fuel metering, pooling allocator for predictable resource usage.
  - Precompilation/caching: supports ahead-of-time compilation and serialized modules to reduce cold starts.
  - Well-documented embedding API (Rust first-class, C API for other languages). We will implement the Runner as a Rust service embedding Wasmtime.

Implementation notes:
- Language targets: prioritize AssemblyScript and Rust for authoring extensions that compile to WASI-compatible WASM; consider TinyGo where appropriate. Provide a TypeScript SDK for descriptor-driven UIs and for authoring AssemblyScript-based handlers.
- Host API binding: expose capability-scoped functions as WASI-like imports via Wasmtime’s Linker (e.g., `alga.storage.get/set`, `alga.http.fetch`, `alga.secrets.get`, `alga.log.info`). No filesystem preopens; no ambient authority.
- Resource controls: enforce per-invocation memory limits, timeouts via epoch interruption, and optional fuel metering for CPU budgeting. Configure pooling allocator to cap concurrent memory usage.
- Provenance: require signed bundles; verify content hash and signature before loading modules. Cache precompiled modules by hash.
- Isolation: one module instance per invocation (or per short-lived execution window). No shared mutable state beyond brokered APIs.
- Multi-pod safety: Raw and precompiled artifacts stored in object storage keyed by content hash + target. Runners use only ephemeral local caches; no node-local persistent volumes required.

### Execution Lifecycle
1. Authoring: Devs build against SDK + Host API types; `alga-ext` CLI validates locally.
2. Package: CLI produces a bundle (manifest, lockfile, compiled WASM) and signs it; optional AOT precompile for target architectures.
3. Publish: Push to registry; bundle stored in object storage by content hash.
4. Install: Tenant admin approves capabilities; per-tenant install record created with RLS.
5. Run: Event triggers runner → verify signature → load/precompiled module → instantiate with restricted Store/Linker → execute handler with brokered I/O only.
6. Observe: Logs, metrics, and traces recorded with per-tenant attribution; failures are quarantined.

### Security Controls
- Code provenance: signature verification, content-addressed storage, SBOM capture.
- Sandboxing: Wasmtime isolates; no in-process eval/import of tenant JS; no preopened FS; no raw sockets; capability-scoped host imports only.
- Resource limits: Wasmtime memory limits, epoch-based timeouts, optional fuel metering, and concurrency guards via worker pools.
- Egress policy: deny by default; allowlist per tenant/extension with optional TLS pinning.
- Secrets: mounted via broker with fine-grained tokens; never exposed wholesale.
- Audit: structured logs, event->execution correlation IDs, immutable execution logs with retention.

### Data Model (initial)
- `extension_registry(id, name, publisher, latest_version, deprecation, created_at)`
- `extension_version(id, registry_id, semver, content_hash, signature, sbom_ref, created_at)`
- `extension_bundle(id, content_hash, storage_url, size, runtime, sdk_version)`
- `tenant_extension_install(id, tenant_id, registry_id, version_id, status, granted_caps, config, created_at)`
- `extension_secret(id, tenant_install_id, key, created_at)` (values in secret manager; reference only)
- `extension_event_subscription(id, tenant_install_id, event, filter, created_at)`
- `extension_kv_store(tenant_id, extension_id, namespace, key, value, updated_at)` with RLS
- `extension_execution_log(id, tenant_id, extension_id, event_id, started_at, finished_at, status, metrics, error)`
- `extension_quota_usage(tenant_id, extension_id, window_start, cpu_ms, mem_mb_ms, invocations, egress_bytes)`

### Public APIs (EE)
- Registry: list/get/publish/deprecate versions (publisher-scoped, admin-only operations).
- Installation: install/uninstall/update; grant/revoke capabilities; manage secrets; validate config.
- Execution Admin: test-run, health, metrics, and logs (scoped to tenant).
- Event Subscriptions: list/update per tenant install.

## EE Code Audit (current implementation)

The following summarizes the current EE extension implementation and where the unsafe patterns arise:

- Initialization loads from local filesystem:
  - File: `ee/server/src/lib/extensions/initialize.ts`
  - Behavior: Computes `extensionsDir = path.join(process.cwd(), 'extensions')` and calls `loader.loadExtensions()`; any directory under `extensions/` is treated as an extension.

- Loader reads manifests and rewrites paths to local extension files:
  - File: `ee/server/src/lib/extensions/loader.ts`
  - Behavior: Reads `<ext>/alga-extension.json`, rewrites `main`, `components[*].component`, and `api.endpoints[*].handler` to paths under `/extensions/<extName>/...`, then registers the extension for all tenants by enumerating `tenants` table (no per-tenant isolation on discovery).

- Registry persists extension metadata and main entry point:
  - File: `ee/server/src/lib/extensions/registry.ts`
  - Behavior: `registerExtension()` stores `manifest` JSON and `main_entry_point` (from manifest) in `extensions` table; manages `extension_permissions` and per-tenant records but assumes extensions are available via the on-disk paths.

- UI runtime dynamically imports extension JS from server endpoint:
  - File: `ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx`
  - Behavior: In browser, uses `import(/* webpackIgnore */ componentUrl)` where `componentUrl = /api/extensions/${extensionId}/components/${componentPath}`. This implies an API that serves raw JS modules from the extension’s on-disk files.
  - Note: Docs reference this endpoint (`/api/extensions/[extensionId]/components/[...path]`), though the implementation may live outside the visible tree in this workspace.

- Installation accepts uploaded file as extension package:
  - File: `ee/server/src/lib/actions/extensionActions.ts` (`installExtension`)
  - Behavior: Currently a stub that would extract, validate, and “store the extension files” before registration. This confirms the design intent to place tenant-supplied code onto server disk for dynamic loading.

- Storage and security:
  - `ee/server/src/lib/extensions/storage/storageService.ts` implements tenant-scoped storage (DB + Redis) with prefixes and RLS assumptions. This is orthogonal to the code-execution issue.
  - `ee/server/src/lib/extensions/security/propWhitelist.ts` constrains UI descriptor props but does not mitigate dynamic code execution.

Key risks in the current EE approach:
- In-process code import: Browser loads JS provided by tenants; server likely serves modules directly from tenant-uploaded files. Server could also import server-side handlers similarly (manifest `api.endpoints[*].handler`).
- Shared process/host: Files are mounted in app’s runtime; any misuse in serving or importing can impact all tenants.
- Cross-tenant registration: Loader currently registers new extensions for all tenants by default.
- No provenance guarantees: No signed bundles; files are mutable and path-based.

Conclusion: The audit corroborates the need to deprecate the on-disk, in-process code path in favor of signed artifacts and out-of-process execution.

## Migration Plan

Phase 0 – Pre-GA Launch Gates (since not deployed)
- Do not enable any path that uploads or serves tenant JS into the app process.
- Keep filesystem scanning of `extensions/` disabled in production configs; use only registry-driven, signed bundles when this feature is introduced.
- Allow webhook-style integrations for demos only if needed; document they’ll migrate to Runner/Host API later.

Note: These are planning gates rather than emergency mitigations, as the feature is not yet live.

## Migration From Current EE Implementation

Delta plan mapping current files to target approach:

- `ee/server/src/lib/extensions/initialize.ts`
  - Today: scans `process.cwd()/extensions` and bulk-loads all extension dirs.
  - Target: remove filesystem scan; call `RegistrySync` to fetch extension installs for the current tenant from DB; resolve to bundle versions (content hash) stored in object storage.

- `ee/server/src/lib/extensions/loader.ts`
  - Today: reads `alga-extension.json`, rewrites paths to `/extensions/<name>/...`, registers for all tenants.
  - Target: delete/replace with `BundleResolver` that takes `registry_id/version_id → content_hash` and returns immutable bundle descriptors; registration occurs per-tenant via install flow only.

- `ee/server/src/lib/extensions/registry.ts`
  - Today: stores `manifest`, `main_entry_point`, and permissions; per-tenant rows exist but discovery is global.
  - Target: extend schema to include `extension_registry`, `extension_version`, `extension_bundle` with content hash + signature; `tenant_extension_install` holds granted capabilities and selected version. No global auto-registration.

- `installExtension` (server action): `ee/server/src/lib/actions/extensionActions.ts`
  - Today: accepts uploaded file and intends to extract/store files.
  - Target: remove upload-to-disk; replace with “Install by Registry” flow selecting a signed version; for private dev, use CI publish to registry, not runtime upload.

- Component serving (docs reference `/api/extensions/[extensionId]/components/[...path]`):
  - Today: client uses `import(/* webpackIgnore */ url)` to load tenant JS modules from server.
  - Target: deprecate raw JS module serving. Serve only sandboxed iframe apps via signed URLs from object storage/CDN; never dynamic-import tenant JS into the host app.

- UI rendering (`ExtensionRenderer.tsx`):
  - Today: dynamic import from API URL; descriptor mode is partially implemented.
  - Target: remove host-side descriptor rendering and dynamic import; render iframe apps exclusively with the Client SDK bridge.

- Storage/security services:
  - Keep tenant-scoped storage with RLS; expose through Host API in runner, not directly from browser. Add optional at-rest encryption of sensitive values.

## Bundle & Manifest v2 (draft)

- Manifest keys: `name`, `publisher`, `version`, `runtime` (e.g., `wasm-js@1`), `capabilities` (explicit list), `ui` (iframe app definition), `events` (subscriptions), `entry` (runner entrypoint), `assets` (UI/static files), `sbom`.
- Artifact: tarball with deterministic layout; top-level `manifest.json`, `entry.wasm` or isolated JS, `descriptors/`, and `SIGNATURE`.
- Signing: compute SHA256 over canonical bundle; sign with developer certificate; store signature and public cert in registry.

Example (abridged):
```
{
  "name": "com.alga.softwareone",
  "publisher": "SoftwareOne",
  "version": "1.2.3",
  "runtime": "wasm-js@1",
  "capabilities": ["http.fetch", "storage.kv", "secrets.get"],
  "ui": {
    "type": "iframe",
    "entry": "ui/index.html",
    "routes": [
      { "path": "/agreements", "iframePath": "ui/agreements.html" },
      { "path": "/statements", "iframePath": "ui/statements.html" }
    ]
  },
  "events": [{ "topic": "billing.statement.created", "handler": "dist/handlers/statement.js" }],
  "entry": "dist/main.wasm",
  "precompiled": {
    "x86_64-linux-gnu": "artifacts/cwasm/x86_64-linux-gnu/main.cwasm",
    "aarch64-linux-gnu": "artifacts/cwasm/aarch64-linux-gnu/main.cwasm"
  },
  "api": {
    "endpoints": [
      { "method": "GET", "path": "/agreements", "handler": "dist/handlers/http/list_agreements" },
      { "method": "POST", "path": "/agreements/sync", "handler": "dist/handlers/http/sync" }
    ]
  },
  "assets": ["ui/**/*"],
  "sbom": "sbom.spdx.json"
}
```

## Host API v1 (draft surface)

- Core: `context.extension()`, `context.tenant()`, `context.user()`
- Storage: `storage.get/set/delete/list`, namespaces; per-tenant/per-extension isolation
- HTTP: `http.fetch(url, opts)` via egress broker with allowlists
- Secrets: `secrets.get(key)` returning scoped secret handles
- Events: `events.emit(topic, payload)`, `events.subscribe(topic)` via manifest
- Schedules: `schedules.register(id, cron, handler)` (phase 2/3)
- Logging/Metrics: `log.info/warn/error`, `metrics.counter/gauge/histogram`

## Milestones & Acceptance

- M1: Registry + Bundle Store + Signing
  - Publish/Install flows working; schema migrations in place; signatures verified on install
- M2: Runner Service + Host API v1
  - Execute a hello-world WASM extension via Wasmtime with quotas/timeouts and audit logs
- M3: Client SDK (iframe)
  - Render UI via iframe apps using the Alga Client SDK; CSP enforced; no raw dynamic import of tenant JS
- M4: E2E for first partner
  - One extension fully migrated; per-tenant install/config on prod-like env

Phase 1 – Foundations
- Ship SDK v1, Host API v1 (capabilities: events, storage.kv, http.fetch via broker, secrets.get, log/metrics).
- Implement Registry, Bundle Storage, and Build validation path; enable signed bundle install.

Phase 2 – Runner Service
- Add WASM/isolate runner with quotas, timeouts, and signature verification.
- Integrate Event Bus; implement execution logs and basic metrics.

Phase 3 – UI Extensions
- Iframe-based UI host with CSP sandbox and postMessage bridge; asset signing pipeline.

Phase 4 – Migration & Deprecation
- Provide migration guides; wrap legacy extensions via out-of-process adapters where feasible.
- Hard deprecate in-process uploads/imports; remove code paths.

## Backwards Compatibility
- Legacy extensions can be proxied through the runner as external HTTP endpoints temporarily.
- Provide an adapter library to help repackage common patterns into bundles.

## Operational Considerations
- Horizontal scale runner workers; shard by tenant to localize impact.
- Warm cache frequently used bundles; prefetch on event bursts.
- Circuit breakers and quarantine for crash loops or policy violations.

## Success Metrics
- 0 in-process executions of tenant code in app.
- P99 execution latency under target with sandboxing enabled.
- No cross-tenant data access in penetration tests.
- All bundles signed and verified; 100% execution logs correlated to events.

## Open Questions
- Which sandbox runtime to standardize on first: WASM (Wasmtime/WASI) vs V8 isolates? Preference: WASM for stronger capability discipline; allow a container tier for heavy/legacy cases.
- Initial capability set scope: finalize MVP host APIs.
- Pricing/billing alignment with quotas and egress costs.

## Next Steps
- Spec Host API v1 and SDK v1.
- Define bundle manifest schema and signing model.
- Draft DB migrations for the data model above with RLS.
- Build a minimal runner prototype with one event flow E2E.
