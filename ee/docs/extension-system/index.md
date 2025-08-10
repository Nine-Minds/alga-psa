# Alga PSA Extension System Documentation (Enterprise)

## Overview

1. [Overview](overview.md)
   - Goals and isolation model
   - Architecture components (Runner, Registry, Gateway, UI)
   - Security and quotas

2. [Implementation Plan](implementation_plan.md)
3. [Runner Service](runner.md)
   - Responsibilities and interfaces
   - Static UI asset hosting
   - Execution model, quotas, and host APIs

## Technical Specifications

1. [Manifest v2 Schema](manifest_schema.md)
   - Schema definition and examples
   - Endpoints, ui.iframe, capabilities, precompiled artifacts, assets

2. [Registry Implementation](registry_implementation.md)
   - Data model (registry, version, bundle, install, logs)
   - Services (publish/list/get/install)

3. [API Routing Guide](api-routing-guide.md)
   - `/api/ext/[extensionId]/[...]` gateway → Runner
   - Header, limit, and timeout policies

4. [Security & Signing](security_signing.md)
   - Content‑addressed bundles (sha256:…)
   - Signature verification and trust bundles
   - Quotas and egress allowlists

## Developer Resources

1. [Development Guide](development_guide.md)
   - Building server handlers (WASM-first) that execute in the Runner
   - Iframe UI with SDK and UI kit (served by the Runner)
   - Packaging, signing, and publishing bundles

2. [DataTable Integration Guide](datatable-integration-guide.md)
   - Using the UI kit DataTable in iframe apps

3. [Sample Extension](sample_template.md)
   - Project structure
   - Gateway usage
   - End‑to‑end example

## Core Rules (v2-only)

- All extension API requests use `/api/ext/[extensionId]/[...]` and are proxied to the Runner `POST /v1/execute` (see [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)).
- UI is iframe-only and served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`.
- The host constructs iframe src via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45).
- Registry v2 is authoritative for extension versions and bundle metadata (see [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)).

See the [Implementation Plan](implementation_plan.md) for additional details.
