# Alga PSA EE Extension System — Out-of-Process, Multi‑Tenant

This directory contains the Enterprise Edition documentation for the Alga PSA Extension System. The system is being overhauled to provide strong multi‑tenant isolation, signed/reproducible artifacts, and a secure, capability‑based execution model.

Status: This documentation reflects the target architecture and phased rollout (Aug 2025). Legacy, in‑process patterns are deprecated and noted as such.

## Documentation Index

### Core Architecture
- [Overview](overview.md) — Goals, isolation model, components
- [Implementation Plan](implementation_plan.md) — Phased plan aligned with the overhaul
- [Development Guide](development_guide.md) — Building extensions (server handlers + iframe UI)

### Technical Guides
- [API Routing Guide](api-routing-guide.md) — Gateway pattern `/api/ext/[extensionId]/[...]` to Runner
- [Client UI Template/SDK Guide](template-system-guide.md) — Iframe SDK and UI kit usage (replaces descriptor rendering)
- [DataTable Integration Guide](datatable-integration-guide.md) — Using the UI kit DataTable in iframe apps
- [Enterprise Build Workflow](enterprise-build-workflow.md) — EE build, packaging, and publish

### Reference
- [Manifest Schema](manifest_schema.md) — Manifest v2 (runtime, endpoints, ui, capabilities)
- [Registry Implementation](registry_implementation.md) — Data model and services
- [Security & Signing](security_signing.md) — Bundle signing, verification, quotas
- [Sample Extension](sample_template.md) — Server handler + iframe UI example
- [Index](index.md) — Topical map

## Purpose

The extension system enables:
1. Server‑side handlers executed out‑of‑process via a Runner (WASM first)
2. UI extensions rendered exclusively via sandboxed iframes with a bridge SDK
3. Controlled integrations with external systems via brokered Host APIs

Design goals:
- No tenant code executes in the core app process
- Per‑tenant isolation for compute, storage, and egress
- Signed, content‑addressed bundles with verified provenance
- Capability‑based, least‑privilege host APIs and clear quotas

## Architecture Snapshot (Target)

- Out‑of‑process Runner (Rust + Wasmtime): executes handlers from signed bundles with strict resource limits
- Extension Registry + Bundle Store (S3‑compatible): content‑addressed artifacts (`sha256/<hash>`) and signatures
- API Gateway (Next.js): `/api/ext/[extensionId]/[...]` resolves manifest endpoints → calls Runner `/v1/execute`
- UI Delivery: `/ext-ui/{extensionId}/{content_hash}/[...]` serves cached static assets for iframe apps
- Client SDKs: `@alga/extension-iframe-sdk` (postMessage bridge) and `@alga/ui-kit` (components + theming)

## What Changed (Deprecations)

The following legacy concepts are removed or in the process of removal:
- Descriptor‑based UI rendering inside the host app → replaced by iframe apps using the Client SDK
- Dynamic import of tenant JS from `/api/extensions/...` → no raw module serving into host; use gateway + Runner
- Uploading extension code into server filesystem → replaced by signed bundles published to the registry

Any remaining references in docs are marked Legacy and will be fully removed after migration.

## Getting Started

- Read the [Overview](overview.md) to understand the multi‑tenant model
- Review the [Manifest Schema](manifest_schema.md) and [Security & Signing](security_signing.md)
- Follow the [Development Guide](development_guide.md) to build:
  - Server handlers targeting the Runner (WASM first)
  - An iframe UI that uses the Client SDK and UI kit
- See [Sample Extension](sample_template.md) for an end‑to‑end example

## Roadmap & Phases

The overhaul proceeds in phases (registry/bundles → runner/host API → gateway/UI → migration). See the [Implementation Plan](implementation_plan.md) for the detailed checklist and acceptance criteria.
