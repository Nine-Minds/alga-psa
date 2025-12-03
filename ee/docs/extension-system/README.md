# Alga PSA EE Extension System — Out-of-Process, Multi‑Tenant

This directory contains the Enterprise Edition documentation for the Alga PSA Extension System. The system is v2-only: out-of-process execution, signed/reproducible bundles, an API Gateway that proxies to the Runner, and iframe-only UI served by the Runner.

## Documentation Index

### Core Architecture
- [Overview](overview.md) — Goals, isolation model, components
- [Runner](runner.md) — Responsibilities, configuration, and integration
- [Implementation Plan](implementation_plan.md) — Current plan and acceptance criteria
- [Development Guide](development_guide.md) — Building componentized extensions (WASM handler + iframe UI)

### Technical Guides
- [API Routing Guide](api-routing-guide.md) — Gateway pattern `/api/ext/[extensionId]/[[...path]]` → Runner `/v1/execute`
- [Client UI Template/SDK Guide](template-system-guide.md) — Iframe SDK and UI kit usage
- [DataTable Integration Guide](datatable-integration-guide.md) — Using the UI kit DataTable in iframe apps
- [Enterprise Build Workflow](enterprise-build-workflow.md) — EE build, packaging, and publish

### Reference
- [Manifest Schema](manifest_schema.md) — Manifest v2 (runtime, capabilities, api.endpoints, ui.iframe, precompiled, assets)
- [Registry Implementation](registry_implementation.md) — Data model and services
- [Security & Signing](security_signing.md) — Signed, content‑addressed bundles (sha256:...), verification, quotas
- [Sample Extension](sample_template.md) — Server handler + iframe UI example
- [Index](index.md) — Topical map

## Purpose

The extension system enables:
1. Server‑side handlers executed out‑of‑process via a Runner (WASM-first)
2. UI extensions rendered exclusively via sandboxed iframes with a bridge SDK
3. Controlled integrations with external systems via capability-based Host APIs

Design goals:
- No tenant code executes in the core app process
- Per-tenant isolation for compute, storage, and egress
- Signed, content-addressed bundles with verified provenance (sha256:…)
- Least-privilege host APIs with quotas and auditable execution
- Component-model execution so extensions produced via `componentize-js` + `@alga-psa/extension-runtime` behave consistently across languages

## Architecture Snapshot

- Runner (Rust + Wasmtime components): executes handlers produced by `componentize-js`, enforces capability-scoped host APIs, and serves static iframe UI assets at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`.
- Registry + Bundle Store (S3-compatible): content-addressed artifacts, install-scoped config, provider grants, and sealed secret envelopes.
- API Gateway (Next.js): `/api/ext/[extensionId]/[[...path]]` looks up the tenant install via `@ee/lib/extensions/installConfig`, forwards `{context, http, limits, config, providers, secret_envelope}` to Runner `POST /v1/execute`, and proxies the response. Manifest endpoint lists are advisory; enforcement is undecided (see alignment plan).
- Client SDKs: `@alga/extension-iframe-sdk` (postMessage bridge) and `@alga/ui-kit` (components + theming), plus `@alga-psa/extension-runtime` for component handlers.

## Correctness Rules

- All extension API calls go through `/api/ext/[extensionId]/[[...path]]` and are proxied to Runner `/v1/execute`. Reference the Next.js handler at [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts).
- UI assets are served by the Runner only at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`; the Next.js `ext-ui` route is a gate that returns 404/redirect when rust-host mode is active.
- Iframe src is constructed by [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstrapped via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)
- Tenant install metadata (config, providers, secret envelopes) flows through [@ee/lib/extensions/installConfig](../../server/src/lib/extensions/installConfig.ts) and is attached to each execute request so the Runner can unlock capabilities.
- Registry v2 and signing integrate with [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)

## Runner Configuration (host environment)

- RUNNER_BASE_URL — internal URL used by the Gateway to call `POST /v1/execute`
- RUNNER_PUBLIC_BASE — public base used to construct ext-ui iframe src
- EXT_GATEWAY_TIMEOUT_MS — gateway → runner request timeout
- SIGNING_TRUST_BUNDLE — trust anchors for signature verification
- EXT_EGRESS_ALLOWLIST — optional comma-separated host list used by the Wasmtime HTTP capability guardrail

## Configuration Summary

Server and Runner use these environment variables:

- Gateway/Runner
  - `RUNNER_BASE_URL` (Gateway → Runner execute API)
  - `RUNNER_PUBLIC_BASE` (iframe UI base)
  - `EXT_GATEWAY_TIMEOUT_MS` (Gateway timeout)
  - `SIGNING_TRUST_BUNDLE` (signature verification trust anchors)
  - `DEBUG_STREAM_REDIS_URL`, `RUNNER_DEBUG_REDIS_STREAM_PREFIX`, `RUNNER_DEBUG_REDIS_MAXLEN` (live debug stream fan-out)

- Object Storage (S3/MinIO)
  - `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`
  - `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`
  - `STORAGE_S3_BUCKET`, `STORAGE_S3_FORCE_PATH_STYLE`
  - `STORAGE_S3_BUNDLE_BUCKET` (optional override for bundles)

Refer to this list from other docs to avoid drift. See Runner S3 guide for runtime-specific notes.

## Live Debug Console

- Runner emits stdout/stderr/log events as `ExtDebugEvent` records via Redis Streams when `RUNNER_DEBUG_REDIS_URL` is configured. See [server/src/lib/extensions/debugStream/redis.ts](../../../server/src/lib/extensions/debugStream/redis.ts).
- EE exposes `/api/ext-debug/stream` (SSE) and the MSP UI at `/msp/extensions/[id]/debug` so authorized users can watch events in real time.
- Feature flags, tenant scoping, and capability gating are tracked in [2025-11-12-extension-system-alignment-plan](../plans/2025-11-12-extension-system-alignment-plan.md).

## Getting Started

- Read the [Overview](overview.md)
- Review the [Manifest Schema](manifest_schema.md) and [Security & Signing](security_signing.md)
- Follow the [Development Guide](development_guide.md) to build:
  - Server handlers targeting the Runner (WASM-first)
  - An iframe UI that uses the Client SDK and UI kit
- See [Sample Extension](sample_template.md) for an end‑to‑end example

## Host Embedding Quickstart (iframe)

- Construct src with the canonical helper: `buildExtUiSrc(extensionId, contentHash, path, { tenantId? })` from `server/src/lib/extensions/ui/iframeBridge.ts`.
- If `RUNNER_PUBLIC_BASE` is absolute, set `allowedOrigin` to that origin before bootstrapping the iframe.
- Bootstrap once the iframe element exists:

```ts
import { buildExtUiSrc, bootstrapIframe } from 'server/src/lib/extensions/ui/iframeBridge';

const src = buildExtUiSrc(extId, contentHash, '/');
iframe.src = src;
bootstrapIframe({
  iframe,
  extensionId: extId,
  contentHash,
  initialPath: '/',
  session: { token, expiresAt },
  themeTokens,
  allowedOrigin: process.env.RUNNER_PUBLIC_BASE, // required when absolute
});
```

- ext-ui is always served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/...`; the Next.js `ext-ui` route only gates/redirects when rust-host mode is enabled.
