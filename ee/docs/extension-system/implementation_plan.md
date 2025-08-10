# Extension System Implementation Plan (Multi‑Tenant Overhaul)

This implementation plan aligns with the multi‑tenant overhaul and replaces prior 80/20, in‑process designs.

## Phase 0 — Foundations and Switches
- EE‑only wiring: ensure extension code paths are included only in enterprise builds
- Env/config for MinIO/object store, cache root, gateway timeout, and Runner base URL
- Draft Manifest v2 schema and example bundle layout

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
- Use S3‑compatible storage provider against MinIO
- Implement bundle helpers: `getBundleStream`, `getBundleIndex`, `extractSubtree` for `dist/` and `ui/`
- Support optional precompiled artifacts (cwasm) indexed by target triple

## Phase 3 — Runner Service (Rust + Wasmtime)
- Scaffold runner crate and HTTP API `POST /v1/execute`
- Configure Wasmtime (pooling allocator, store limits, epoch timeouts, optional fuel)
- Implement host imports: `alga.storage.*`, `alga.http.fetch`, `alga.secrets.get`, `alga.log.*`, `alga.metrics.emit`
- Fetch/verify/cache modules by `content_hash`; LRU under `EXT_CACHE_ROOT`
- Return normalized `{status, headers, body_b64}` with standardized error codes; add tests

## Phase 4 — Next.js API Gateway
- Add route: `server/src/app/api/ext/[extensionId]/[...path]/route.ts`
- Implement helpers: auth/tenant, registry resolution, endpoint matching, header filtering
- Proxy to Runner `/v1/execute` with service token, timeouts, retries; enforce quotas and size caps

## Phase 5 — Client Asset Fetch‑and‑Serve (Pod‑Local Cache)
- Add route: `server/src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts`
- Implement cache manager: ensure `<EXT_CACHE_ROOT>/<contentHash>/ui/**/*` exists; LRU index; eviction policy
- Implement static serving with SPA fallback, ETag/immutable cache headers, and safe MIME mapping

## Phase 6 — Client SDK and UI Kit
- Create packages:
  - `@alga/extension-iframe-sdk` (handshake, postMessage bridge, auth, navigation, theme)
  - `@alga/ui-kit` (components, tokens, hooks)
- Provide starter React app template using SDK and UI kit
- Implement host bridge bootstrap to inject theme tokens/session

## Phase 7 — Knative Serving (Runner)
- KService manifest with concurrency/scale annotations; health and warmup endpoints
- CI/CD step to deploy Runner revision and smoke test `/v1/execute`

## Phase 8 — EE Code Migration (remove legacy paths)
- Remove filesystem scans and dynamic imports
- Replace upload flows with “Install from Registry”
- Update settings/details pages for per‑tenant installs, versions, and capabilities; add “Open Extension” (iframe) links

## Phase 9 — Security, Quotas, Policy
- Enforce capability grants; block host imports when missing
- Implement per‑tenant egress allowlists for `http.fetch`
- Integrate secrets manager; rotate tokens
- Add per‑tenant/per‑extension quotas and rate limits

## Phase 10 — Observability and Ops
- Structured execution logs with correlation IDs; persist to DB
- Prometheus metrics from Runner (duration, memory, fuel, egress bytes, errors)
- Dashboards and alerts for failure rates, timeouts, and resource breaches

## Phase 11 — Docs, Samples, Pilot
- Developer docs for manifest, building, publishing, installing, and iframe development
- Full sample extension (server handlers + iframe UI)
- Pilot with a partner tenant; validate SLOs and collect feedback

## Acceptance Criteria (Milestones)
- M1: Registry + Bundle Store + Signing in place; install signed bundles
- M2: Runner executes hello‑world with quotas/timeouts and audit logs
- M3: Client SDK (iframe) + asset serving operational; CSP enforced
- M4: First partner extension migrated end‑to‑end

## Backwards Compatibility
- Temporary proxying of legacy external HTTP integrations via Runner where needed
- Provide adapter library for repackaging common patterns into bundles

For technical details see: [Overview](overview.md), [API Routing Guide](api-routing-guide.md), [Security & Signing](security_signing.md), and [Registry Implementation](registry_implementation.md).
