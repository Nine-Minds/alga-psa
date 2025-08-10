# Alga PSA Extension System Documentation (Enterprise)
> Status
>
> This documentation set describes the target Enterprise Extension System. Parts are implemented today; others are in progress. See per‑page status banners and the Overview’s “What is live now / What’s next” for details.


## Overview

1. [Overview](overview.md)
   - Goals and isolation model
   - Architecture components (Runner, Registry, Gateway, UI)
   - Security and quotas

2. [Implementation Plan](implementation_plan.md)
   - Phase‑by‑phase plan
   - Milestones and acceptance criteria
   - EE‑only wiring and migration notes

## Technical Specifications

1. [Manifest v2 Schema](manifest_schema.md)
   - Schema definition and examples
   - Endpoints, ui, capabilities, precompiled artifacts

2. [Registry Implementation](registry_implementation.md)
   - Data model (registry, version, bundle, install, logs)
   - Services (publish/list/get/install)

3. [API Routing Guide](api-routing-guide.md)
   - `/api/ext/[extensionId]/[...]` gateway → Runner
   - Header, limit, and timeout policies

4. [Security & Signing](security_signing.md)
   - Content‑addressed bundles
   - Signature verification and trust bundles
   - Quotas and egress allowlists

## Developer Resources

1. [Development Guide](development_guide.md)
   - Building server handlers (WASM)
   - Iframe UI with SDK and UI kit
   - Packaging and signing bundles

2. [DataTable Integration Guide](datatable-integration-guide.md)
   - Using the UI kit DataTable in iframe apps

3. [Sample Extension](sample_template.md)
   - Project structure
   - Gateway usage
   - End‑to‑end example

## Implementation Roadmap (Summary)

- Phase 0: EE wiring, env/config, schema drafts
- Phase 1: Migrations, registry/install services, signing
- Phase 2: Bundle storage integration
- Phase 3: Runner (Wasmtime)
- Phase 4: API gateway
- Phase 5: UI asset cache and serve
- Phase 6: Client SDK and UI kit
- Phase 7+: Deployment, migration, security/quotas, observability, pilot

See the [Implementation Plan](implementation_plan.md) for details.
