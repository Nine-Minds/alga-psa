# Extension System Alignment & Hardening Plan (2025-11-12)

## Context

Recent upgrades (componentized runtime, install-scoped metadata, Redis-backed debug stream) landed across the runner and EE server, but the canonical documentation and parts of the serving pipeline still reflect the pre-component architecture. Several behaviors called out in earlier plans remain unfinished (e.g., manifest endpoint matching, RBAC, capability gating). This plan captures the remaining work so the implementation and docs converge on the true system.

## Goals

1. Close functional gaps between the current gateway/runner implementation and the intended design (config propagation, authz, debug hygiene).
2. Provide audited, tenant-scoped debugging aligned with the Redis stream architecture.
3. Update canonical docs + tooling to describe the component model, install metadata flow, and debug console accurately.

## Non-Goals

- Reverting to the pre-component “dist/handlers” routing model.
- Redesigning capability providers beyond what’s necessary to close the documented gaps.
- Long-term observability/telemetry pipelines (tracked separately).

## Workstream A — Gateway & Registry

| Item | Description | Owner | Status |
| --- | --- | --- | --- |
| A1 | **Include `install_id` in runner Execute context.** The current gateway omits `install_id`, breaking storage and UI proxy host authorization (`server/src/app/api/ext/[extensionId]/[[...path]]/route.ts:220-233`). Update the request payload and add regression tests. | EE Server | ☐ |
| A2 | **Forward config + secret version headers.** Reintroduce `x-ext-config-version`/`x-ext-secrets-version` headers so the runner can invalidate caches (required by `extension-runtime-wasmtime` plan). | EE Server | ☐ |
| A3 | **RBAC and scope checks.** Replace the stubbed `assertAccess` (`server/src/lib/extensions/gateway/auth.ts:27-29`) with tenant-aware read/write enforcement, including integration tests. | EE Server | ☐ |
| A4 | **Manifest endpoint policy decision.** Decide whether the gateway still enforces manifest endpoint matching. If yes, port the resolver into the new route; if no, update schema/docs to mark `api.endpoints` as metadata only. Document the decision. | Arch + Docs | ☐ |
| A5 | **Config/secret propagation docs.** Document install-config + secret envelope flows (tenants, providers, Vault) referencing `ee/server/src/lib/extensions/installConfig.ts`. | Docs | ☐ |

## Workstream B — Runner & Debug Stream

| Item | Description | Owner | Status |
| --- | --- | --- | --- |
| B1 | **Capture stderr/stdout with context.** Today `StderrPipe` emits events with an empty `HostExecutionContext`. Move stderr hookup until after the store context is set, and optionally capture stdout per plan Phase 1. | Runner | ☐ |
| B2 | **Capability gating for debug SSE.** Add manifest/install-level controls (e.g., `cap:debug.logs` or server-side allowlist) before `/api/ext-debug/stream` grants access, aligning with plan Phase 4. Document operator workflow. | EE Server | ☐ |
| B3 | **Session policies & audit trail.** Enforce max session duration, write audit logs (who viewed which tenant/install) and expose them to ops. | EE Server | ☐ |
| B4 | **Redis availability fallback.** Detect Redis failures and bubble a clear warning to the debug console (UI already shows a generic message). Optionally fall back to per-pod streaming per plan Phase 6. | Runner + EE Server | ☐ |
| B5 | **Docs for debug stream.** Add runbooks for enabling `RUNNER_DEBUG_REDIS_URL`, configuring `DEBUG_STREAM_REDIS_*`, and using `/msp/extensions/[id]/debug`. | Docs | ☐ |

## Workstream C — Documentation & SDK

| Item | Description | Owner | Status |
| --- | --- | --- | --- |
| C1 | **Canonical docs refresh.** Update `ee/docs/extension-system/{README,overview,serving-system}.md` to describe the component runtime, Redis debug stream, and correct file paths (`server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`). | Docs | (in progress) |
| C2 | **Manifest & dev guide rewrite.** Align `manifest_schema.md`, `development_guide.md`, and samples with `componentize-js` pipeline (`@alga-psa/extension-runtime`). Remove instructions referencing `dist/handlers/...` entry points unless we reinstate them via A4. | Docs | (in progress) |
| C3 | **API Routing Guide update.** Document the new gateway request structure (config, providers, secret envelopes, version headers) and note remaining TODOs (RBAC, install_id). | Docs | (in progress) |
| C4 | **Runner reference update.** Refresh execute request examples, env vars (`RUNNER_DEBUG_REDIS_*`, `UI_PROXY_*`), and capability descriptions. | Docs | (in progress) |
| C5 | **SDK messaging.** Ensure `sdk/extension-runtime` README and templates link back to the updated docs and clarify version requirements (`componentize-js >= 0.19.3`). | SDK | ☐ |

## Open Questions

1. **Manifest enforcement:** Should the platform continue rejecting routes not listed in `manifest.api.endpoints`, or is the component handler fully dynamic? Need a final product decision (A4).
2. **Debug capability naming:** Do we gate via manifest capability (`cap:debug.logs`), install flag, or environment policy? Coordinate with compliance.
3. **Redis multi-tenant partitioning:** Is the `tenant:extension` stream naming sufficient, or do we need consumer groups per tenant? Outcome affects B4/B5 docs.
4. **Legacy storage API docs:** Do we archive/remove the old storage API files (`storage-api-*.md`) now that secrets/config are delivered via capability providers?

## Timeline & Owners

- **Week of 2025-11-17:** Address A1–A3, B1, and finalize manifest enforcement decision.
- **Week of 2025-11-24:** Ship B2–B4 plus doc updates (C1–C4). Publish operator/developer comms.
- **December 2025:** Close SDK alignment (C5) and any follow-up from open questions.

Progress will be tracked in this document; update status columns as work lands.
