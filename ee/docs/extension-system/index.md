# Alga PSA Extension System Documentation (Enterprise)

## Overview

1. [Overview](overview.md)
   - Goals and isolation model
   - Architecture components (Runner, Registry, Gateway, UI)
   - Security and quotas

2. [Implementation Plan](implementation_plan.md)
3. [Runner Service](runner.md)
   - Responsibilities and interfaces
   - Static UI asset hosting (Rust ext-ui host; Next.js gate returns 404/redirect when RUNNER_PUBLIC_BASE is authoritative)
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

2. [Local Development Guide](local-development.md)
   - Running the Docker-based Extension Runner locally
   - Setting up the development environment
   - Building, installing, and testing extensions
   - Debugging and troubleshooting
   - Workflow tips and advanced configuration

3. [DataTable Integration Guide](datatable-integration-guide.md)
   - Using the UI kit DataTable in iframe apps

4. [Sample Extension](sample_template.md)
   - Project structure
   - Gateway usage
   - End‑to‑end example

## Core Rules (v2-only)

- All extension API requests use `/api/ext/[extensionId]/[[...path]]` and are proxied to the Runner `POST /v1/execute` (see [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)).
- UI is iframe-only and served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`; the Next.js `ext-ui` route is a gate that returns 404 or redirects to the Runner when rust-host mode is enabled.
- **UI→Handler communication uses the postMessage proxy pattern** (NOT direct `fetch()` calls). The iframe sends `apiproxy` messages to the host, which forwards to `/api/ext-proxy/{extensionId}/{route}`. Requires `cap:ui.proxy` capability.
- The host constructs iframe src via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstraps via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45).
- Registry v2 is authoritative for extension versions and bundle metadata (see [ExtensionRegistryServiceV2](../../../server/src/lib/extensions/registry-v2.ts:48)).

See the [Implementation Plan](implementation_plan.md) for additional details.
