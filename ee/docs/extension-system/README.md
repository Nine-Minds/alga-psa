# Alga PSA EE Extension System — Out-of-Process, Multi‑Tenant

This directory contains the Enterprise Edition documentation for the Alga PSA Extension System. The system is v2-only: out-of-process execution, signed/reproducible bundles, an API Gateway that proxies to the Runner, and iframe-only UI served by the Runner.

## Documentation Index

### Core Architecture
- [Overview](overview.md) — Goals, isolation model, components
- [Runner](runner.md) — Responsibilities, configuration, and integration
- [Implementation Plan](implementation_plan.md) — Current plan and acceptance criteria
- [Development Guide](development_guide.md) — Building extensions (server handlers + iframe UI)

### Technical Guides
- [API Routing Guide](api-routing-guide.md) — Gateway pattern `/api/ext/[extensionId]/[...]` → Runner `/v1/execute`
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
- Per‑tenant isolation for compute, storage, and egress
- Signed, content‑addressed bundles with verified provenance (sha256:…)
- Least‑privilege host APIs with quotas and auditable execution

## Architecture Snapshot

- Runner (Rust + Wasmtime): executes handlers from signed bundles with resource limits; also serves static iframe UI assets at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`
- Registry + Bundle Store (S3‑compatible): content‑addressed artifacts and signatures
- API Gateway (Next.js): `/api/ext/[extensionId]/[...]` resolves manifest endpoints and calls Runner `POST /v1/execute`
- Client SDKs: `@alga/extension-iframe-sdk` (postMessage bridge) and `@alga/ui-kit` (components + theming)

## Correctness Rules

- All extension API calls go through `/api/ext/[extensionId]/[...]` and are proxied to Runner `/v1/execute`. Reference gateway scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)
- UI assets are served by the Runner only at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (no Next.js route for ext-ui)
- Iframe src is constructed by [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstrapped via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
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

- Object Storage (S3/MinIO)
  - `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`
  - `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`
  - `STORAGE_S3_BUCKET`, `STORAGE_S3_FORCE_PATH_STYLE`
  - `STORAGE_S3_BUNDLE_BUCKET` (optional override for bundles)

Refer to this list from other docs to avoid drift. See Runner S3 guide for runtime‑specific notes.

## Getting Started

- Read the [Overview](overview.md)
- Review the [Manifest Schema](manifest_schema.md) and [Security & Signing](security_signing.md)
- Follow the [Development Guide](development_guide.md) to build:
  - Server handlers targeting the Runner (WASM-first)
  - An iframe UI that uses the Client SDK and UI kit
- See [Sample Extension](sample_template.md) for an end‑to‑end example
