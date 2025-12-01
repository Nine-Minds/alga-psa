# Extension System Implementation Plan (Enterprise v2)

This plan specifies the v2 Enterprise extension architecture: out-of-process execution in the Runner, signed/content-addressed bundles, a Next.js API Gateway proxying to Runner /v1/execute, and iframe-only UI served by the Runner.

## Phase 0 — Foundations and Switches
- EE-only wiring: ensure extension code paths are included only in enterprise builds
- Env/config for object store, gateway timeout, Runner base/public URL, and trust bundle
- Finalize Manifest v2 schema and example bundle layout

## Phase 1 — Database Schema and Registry Services
- Add EE migrations:
  - extension_registry, extension_version, extension_bundle
  - tenant_extension_install, extension_event_subscription
  - extension_execution_log, extension_quota_usage
  - Enforce tenant isolation (RLS where applicable)
- Implement registry service for publish/list/get; version metadata includes `content_hash`, `signature`, `runtime`, `precompiled`, and `api.endpoints`
- Implement tenant install service (install/uninstall/enable/disable; `granted_caps`, `config`, `version_id`)
- Implement signature verification utility (trust bundle)

## Phase 2 — Bundle Storage Integration
- Use S3‑compatible storage provider (e.g., MinIO)
- Implement bundle helpers: `getBundleStream`, `getBundleIndex`, `extractSubtree` for `dist/` and `ui/`
- Support optional precompiled artifacts (cwasm) indexed by target triple

## Phase 3 — Runner Service (Rust + Wasmtime)
- Runner HTTP API: POST /v1/execute
- Configure Wasmtime (pooling allocator, store limits, epoch timeouts, optional fuel)
- Implement host imports: `alga.storage.*`, `alga.http.fetch`, `alga.secrets.get`, `alga.log.*`, `alga.metrics.emit`
- Fetch/verify/cache modules by `content_hash`; LRU policy
- Return normalized `{status, headers, body_b64}` with standardized error codes and traces

## Phase 4 — Next.js API Gateway
- Add route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Implement helpers: auth/tenant, registry resolution, endpoint matching, header filtering
- Proxy to Runner `POST ${RUNNER_BASE_URL}/v1/execute` with service token, timeouts, limited retries
- Enforce quotas and body/header size caps via configuration (`EXT_GATEWAY_TIMEOUT_MS`, etc.)

## Phase 5 — Runner Static UI Hosting
- Serve iframe UI assets from Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
- Immutable caching (ETag + `Cache-Control: immutable`)
- Runner-managed cache for `ui/**/*` by `content_hash`
- Host constructs iframe URL using [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)

## Phase 6 — Client SDK and UI Kit
- Packages:
  - `@alga/extension-iframe-sdk` (handshake, postMessage, auth, navigation, theme)
  - `@alga/ui-kit` (components, tokens, hooks)
- Provide starter React template using SDK and UI kit
- Implement host bridge bootstrap with theme tokens/session propagation

## Phase 7 — Knative Serving (Runner)
- KService manifest with concurrency/scale bounds; health and warmup endpoints
- CI/CD step to deploy Runner revision and smoke test `/v1/execute`

## Phase 8 — Admin UX and Install Flows
- Admin UI for per‑tenant installs, versions, and capability grants
- “Open Extension” navigates to iframe app constructed from Runner public base and the installed version’s `content_hash`

## Phase 9 — Security, Quotas, Policy
- Enforce capability grants; deny host imports when missing
- Per‑tenant egress allowlists for `http.fetch`
- Integrate secrets manager; enforce rotation policies
- Configure per‑tenant/per‑extension quotas and rate limits

## Phase 10 — Observability and Ops
- Structured execution logs with correlation IDs; persist to DB
- Prometheus metrics from Runner: duration, memory, fuel, egress bytes, errors
- Dashboards and alerts for failure rates, timeouts, resource breaches

## Phase 11 — Docs, Samples, Pilot
- Developer docs for manifest, building, publishing, installing, and iframe development
- Full sample extension (server handlers + iframe UI)
- Pilot with a partner tenant; validate SLOs and collect feedback

## Acceptance Criteria (Milestones)
- M1: Registry + Bundle Store + Signing operational; can install signed bundles
- M2: Runner executes hello‑world with quotas/timeouts and audit logs
- M3: Client SDK (iframe) + Runner UI hosting operational; CSP and sandbox enforced
- M4: First partner extension on v2 end‑to‑end

## References
- Overview: [overview.md](overview.md)
- Routing: [api-routing-guide.md](api-routing-guide.md)
- Security & Signing: [security_signing.md](security_signing.md)
- Registry: [registry_implementation.md](registry_implementation.md)
- Gateway route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe bootstrap and src builder: [server/src/lib/extensions/ui/iframeBridge.ts](../../../server/src/lib/extensions/ui/iframeBridge.ts:38)
