# Descriptor Architecture Implementation Plan (Deprecated)

This document previously outlined a path to a descriptor‑based, in‑process extension model. As of Aug 2025, that approach is deprecated in favor of the Multi‑Tenancy Overhaul:

- Out‑of‑process Runner (Rust + Wasmtime)
- Signed, content‑addressed bundles in object storage
- Gateway proxy at `/api/ext/[extensionId]/[...]`
- Iframe‑only UI using the Client SDK and UI kit

Please refer to the following documents for the authoritative plan and technical details:
- [Implementation Plan](implementation_plan.md) — phase breakdown and acceptance criteria
- [Overview](overview.md) — architecture and components
- [Manifest Schema](manifest_schema.md) — Manifest v2 surface (endpoints, ui, capabilities)
- [Security & Signing](security_signing.md) — signing, verification, quotas, egress policy

## Migration Mapping (Legacy → New)

- Descriptor rendering in host → Iframe apps using `@alga/extension-iframe-sdk`
- Dynamic import of tenant JS → No in‑process imports; Runner executes handlers
- `/api/extensions/...` routes → `/api/ext/[extensionId]/[...]` via gateway
- Upload to filesystem → Publish signed bundles to registry; install by version

This file is retained for historical context only and will be removed after migration is complete.
