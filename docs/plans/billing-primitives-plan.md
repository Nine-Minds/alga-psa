# Billing Primitives Implementation Plan (Phased)

This plan outlines the steps to introduce the primitives-based WASM billing runtime, achieve parity with the current engine, and enable customization.

## Phase 0 — Specs & Schemas (Design Freeze)

- Deliverables:
  - JSON Schemas: Charge IR, Facts, Events, Context, Program (pipeline config)
  - TypeScript/AssemblyScript SDK interfaces mirroring schemas
  - Determinism & Money policy (integer cents, rounding rules)
  - Module Manifest Spec (declare-what-you-use for facts/events/scope)
  - Core Fact Packs (V1) catalog with field lists and filters
- TODOs:
  - Define minimal required fields + optional hints (tax_region_hint)
  - Establish dimensions naming conventions (non-breaking, tenant-extensible)
  - Author schema tests and example fixtures
  - Write README and contribution guide for module authors
- Acceptance:
  - Schemas and SDK published; fixtures validate; docs reviewed

## Phase 1 — Module Registry & Bindings

- Deliverables:
  - Tables: `billing_scripts`, `billing_script_bindings`, `billing_executions`
  - CRUD actions/APIs for upload, versioning, signing, binding
- TODOs:
  - Implement blob storage (DB for V1), hashing, optional signing
  - Binding resolution logic with priorities and scoping (tenant, plan_type, plan_id, bundle_id)
  - Admin UI stub or CLI for managing modules
- Acceptance:
  - Can upload, bind, and resolve a module for a scope; executions log metadata

## Phase 2 — Runtime Orchestrator Skeleton

- Deliverables:
  - WASM sandbox executor with CPU/memory caps; JSON in/out
  - Program runner: deterministic stage ordering, scope fan-out for Producers
  - Fact Planner service: resolves manifests → builds a unified Fact Plan
- TODOs:
  - Module cache (in-memory) with eviction
  - Input hashing, output snapshotting, structured warnings capture
  - Error handling with safe fallbacks; feature flag gating
- Acceptance:
  - Hello-world module runs end-to-end; execution logged; limits enforced

### CLI Outline: plan-inputs (introduced in Phase 2)

- Command: `alga-billing plan-inputs --company <id> --period <start:end> [--pipeline <file>]`
- Behavior: loads tenant pipeline + bindings, resolves module manifests, prints Fact Plan
  - Output includes: pack kind, fields, filters, version selected, estimated record counts
  - Options: `--json` for machine output; `--validate-only` to check availability without fetching
  - Exit codes: 0 (ok), 2 (missing required pack/field), 3 (version conflict)

## Phase 3 — Fixed Producer + Bundle Transformer (POC Parity)

- Deliverables:
  - `fixed-fmv` Producer (FMV allocation + proration)
  - `bundle-flat-rate` Transformer (enforce custom_rate semantics, grouping/labeling)
- TODOs:
  - Map current plan services to Facts; assignment to Scope
  - Golden tests vs legacy Fixed behavior across edge cases (proration on/off, partial periods)
  - Preview/dry-run endpoint to diff outputs
- Acceptance:
  - Parity within ±1 cent on all fixtures; diff tool shows matches

## Phase 4 — Hourly, Usage, Bucket Producers

- Deliverables:
  - `hourly` Producer (min/round, user-type rates)
  - `usage-tiers` Producer (min usage + tiers)
  - `bucket-overage` Producer (overage and rollover awareness)
- TODOs:
  - SDK helpers: proration, tier evaluation, rounding, safe money ops
  - Extensive fixture suite drawn from real data patterns
  - Dimension coverage (user_type, category, bucket_id)
- Acceptance:
  - Parity with legacy engine on representative datasets; performance within targets

## Phase 5 — Discount/Capping Transformers

- Deliverables:
  - `category-coupons`, `cap-total`, `first-n-free`, `manual-adjustments`
- TODOs:
  - Policy configs and bindings per tenant
  - Validation rules to prevent over-discounting
  - Reporting hooks (rule IDs in metadata)
- Acceptance:
  - Functional tests with scenarios; clean audit lines on invoices

## Phase 6 — Host Integration: Tax, Rounding, Persistence

- Deliverables:
  - Host applies tax via existing TaxService using `is_taxable`/`tax_region_hint`
  - Invoice persistence with `invoice_item_details` including module metadata (module_id, version, hash)
- TODOs:
  - Update invoice totals path to consume Charge IR
  - Idempotency and rerun safety (no double-billing)
  - Backfill of execution records for previews/finals
- Acceptance:
  - End-to-end invoice generation through new runtime for opted tenants

## Phase 7 — SDK, CLI, and Authoring UX

- Deliverables:
  - `@alga/billing-plugin-sdk` (AssemblyScript) + scaffolding templates
  - CLI: build/sign/publish, dry-run against fixtures, local test harness, 
- TODOs:
  - Example modules published (Fixed, Hourly, Usage, Bucket, Bundle, Discounts)
  - Documentation and best practices
- Acceptance:
  - Third-party module can be authored, tested, published, and bound successfully

## Phase 8 — Security & Performance Hardening

- Deliverables:
  - Module signing + allowlists, review gates
  - Load tests and concurrency benchmarks; cache tuning
- TODOs:
  - Fuzz/property tests for modules and orchestrator
  - Memory/time budget telemetry; backpressure controls
  - Clear error surfaces and fallbacks
- Acceptance:
  - Meets SLOs for throughput and latency; safe under stress

## Phase 9 — Pilot, Dual-Run, Cutover

- Deliverables:
  - Feature flags for per-tenant and per-plan rollout
  - Dual-run pipeline generating non-persistent previews for comparison
  - Migration playbook and rollback plan
- TODOs:
  - Golden diff dashboards
  - Support readiness, docs, and training
  - Deprecation timeline for legacy engine paths
- Acceptance:
  - Successful pilots; parity validated; cutover executed with rollback safety

## Risks & Mitigations

- Performance overhead (WASM + JSON): module caching, bounded inputs, parallel scopes
- Debuggability: execution snapshots, structured logs, local harness, golden diffs
- Schema drift: stable core schemas; optional fields for growth; version pinning
- Security of custom code: signing, allowlists, strict sandbox, resource caps

## Success Criteria

- Functional parity for current plans/bundles with measurable stability
- Clear path for bespoke tenant logic without core changes
- Deterministic, auditable billing runs with reproducible outcomes

