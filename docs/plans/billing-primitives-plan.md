# Billing Primitives Implementation Plan (Phased)

This plan outlines the steps to introduce the primitives-based WASM billing runtime as the initial system and enable deep customization.

## Phase 0 — Specs & Schemas (Design Freeze)

- Deliverables:
  - JSON Schemas: Charge IR, Facts (including Tax Fact Packs), Events, Context, Program (pipeline config)
  - TypeScript SDK interfaces mirroring schemas (for Javy JS/TS modules)
  - Determinism & Money policy (integer cents, rounding rules)
  - Module Manifest Spec (declare-what-you-use for facts/events/scope)
  - Core Fact Packs (V1) catalog with field lists and filters
- TODOs:
  - Define minimal required fields + optional hints (tax_region_hint)
  - Establish dimensions naming conventions (non-breaking, tenant-extensible)
  - Author schema tests and example fixtures (vitest)
  - Write README and contribution guide for module authors
- Acceptance:
  - Schemas and SDK published; fixtures validate; docs reviewed

## Phase 1 — Module Registry & Bindings

- Deliverables:
  - Tables: `billing_scripts`, `billing_script_bindings`, `billing_executions`
  - CRUD actions/APIs for upload, versioning, signing, binding
  - Module storage via `StorageService` (provider‑agnostic: local or S3‑compatible like MinIO); DB stores metadata + provider path
  - Trust/ownership fields in registry: `origin_type (system|tenant|partner)`, `owner_tenant_id?`, `trust_tier`, `signature`, `sha256`
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
  - Test harness scaffold (vitest) for module and pipeline tests
  - On-demand module fetch via `StorageService` (no local cache in V1)
- TODOs:
  - (Optional later) instrumentation for load times and memory; no module cache in V1
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

## Phase 3 — Core Producers + Bundle Transformer

- Deliverables:
  - `fixed-fmv` Producer (FMV allocation + proration)
  - `hourly` Producer (min/round, user-type rates)
  - `usage-tiers` Producer (min usage + tiers)
  - `bucket-overage` Producer (overage and rollover awareness)
  - `bundle-flat-rate` Transformer (enforce custom_rate semantics, grouping/labeling)
- TODOs:
  - Map plan services/configs to Facts; assignment to Scope
  - Write unit tests for each Producer and transformer (vitest)
  - Add scenario tests for proration, min/rounding, tier paths, rollover
- Acceptance:
  - Green tests covering Producers and bundle transformer across edge cases

## Phase 4 — Discounts/Capping + Tax Transformer

- Deliverables:
  - `category-coupons` Transformer (threshold/category promos)
  - `cap-total` Transformer (monthly caps)
  - `first-n-free` Transformer (intro allowances)
  - `manual-adjustments` Transformer (operator-driven adjustments)
  - `tax` Transformer (multi-component, inclusive/exclusive, rounding policies)
- TODOs:
  - SDK helpers: proration, tier evaluation, rounding, safe money ops
  - Tax Fact Packs defined and validated
  - Write unit tests for discount/cap transformers and tax transformer
  - Scenario tests: multi-component tax, inclusive pricing, discount allocation, exemptions, rounding
- Acceptance:
  - Green tests for discounts/caps and tax across representative datasets; performance within targets

## Phase 5 — Persistence, Rounding, and Invoice Generation

- Deliverables:
  - Invoice persistence wired to Charge IR
  - Rounding policy application at line/jurisdiction/invoice levels per policy
  - Execution logging and audit fields (module_id, version, hash, input hash)
- TODOs:
  - Validation rules to prevent over-discounting
  - Reporting hooks (rule IDs in metadata)
  - Write integration tests from Charge IR to persisted invoices (vitest, using test DB)
- Acceptance:
  - End-to-end invoice generation from Program to DB; audit lines present

## Phase 6 — SDK, CLI, and Authoring UX (Javy; system modules)

- Deliverables:
  - `@alga/billing-plugin-sdk` (JavaScript/TypeScript for Javy) + scaffolding templates
  - CLI: build/sign/publish, dry-run against fixtures, local test harness, `plan-inputs`; compile-to-Wasm step
- TODOs:
  - Example modules published (Fixed, Hourly, Usage, Bucket, Bundle, Discounts, Tax) in JS/TS
  - Documentation and best practices
  - CLI tests for plan-inputs and publish flows
- Acceptance:
  - System module can be authored in JS/TS, tested (vitest), compiled to Wasm (Javy), published, and bound successfully

## Phase 7 — Security & Performance Hardening

- Deliverables:
  - Module signing + allowlists, review gates
  - Load tests and concurrency benchmarks; focus on fetch latency and CPU/memory limits
- TODOs:
  - Fuzz/property tests for modules and orchestrator
  - Memory/time budget telemetry; backpressure controls
  - Clear error surfaces and fallbacks
- Acceptance:
  - Meets SLOs for throughput and latency; safe under stress

## Phase 7a — Tenant Custom Modules (optional later phase)

- Deliverables:
  - Publisher flow for tenant modules (upload → hash/sign → store via StorageService → registry insert)
  - Review/allowlist workflow and trust tiers; per-tenant quotas; revocation path
  - Binding UI to opt-in to tenant/partner modules by scope with precedence rules
- TODOs:
  - Signature verification on fetch and execution policy enforcement
  - Malicious module tests (infinite loop, memory abuse) → time/memory caps validated
  - Observability for module errors segregated per tenant
- Acceptance:
  - Tenant-authored module passes tests, is reviewed/allowed, and can be bound and executed within limits

## Phase 8 — Release & Enablement

- Deliverables:
  - Feature flags for staged rollout (optional)
  - Authoring guides and examples for tenants
  - Support readiness and training
- TODOs:
  - Documentation polish and examples expansion
  - Sample pipelines for common MSP templates
- Acceptance:
  - Successful production adoption with documented runbooks

## Risks & Mitigations

- Performance overhead (WASM + JSON): module caching, bounded inputs, parallel scopes
- Debuggability: execution snapshots, structured logs, local harness, golden diffs
- Schema drift: stable core schemas; optional fields for growth; version pinning
- Security of custom code: signing, allowlists, strict sandbox, resource caps

## Success Criteria

- Comprehensive test coverage across modules and scenarios (vitest)
- Clear path for bespoke tenant logic without core changes
- Deterministic, auditable billing runs with reproducible outcomes

## Existing Tests To Reference/Port

These current tests in the repo inform the new test suite. We will mirror their intent against the primitives runtime:

- Infrastructure/integration:
  - `server/src/test/infrastructure/billingInvoiceGeneration_consistency.test.ts`
  - `server/src/test/infrastructure/billingInvoiceGeneration_discounts.test.ts`
  - `server/src/test/infrastructure/billingInvoiceGeneration_edgeCases.test.ts`
  - `server/src/test/infrastructure/billingInvoiceGeneration_subtotal.test.ts`
  - `server/src/test/infrastructure/billingInvoiceGeneration_tax.test.ts`
  - `server/src/test/infrastructure/companyBillingCycle.test.ts`
  - `server/src/test/infrastructure/fixedPriceAndTimeBasedPlans.test.ts`
  - `server/src/test/infrastructure/invoiceDueDate.test.ts`
  - `server/src/test/infrastructure/manualInvoice.test.ts`
  - `server/src/test/infrastructure/taxExemptionHandling.test.ts`
  - `server/src/test/infrastructure/taxRateChanges.test.ts`
  - `server/src/test/infrastructure/taxRoundingBehavior.test.ts`
  - `server/src/test/infrastructure/usageBucketAndFinalization.test.ts`
- Unit:
  - `server/src/test/unit/billingEngine.test.ts`
  - `server/src/test/unit/billingCycleActions.test.ts`
  - `server/src/test/unit/taxCalculation.test.ts`
  - `server/src/test/unit/taxService.test.ts`
  - `server/src/test/unit/planDisambiguation.test.ts`
  - `server/src/test/unit/timeEntryBillingPlanSelection.test.tsx`
  - `server/src/test/unit/bucketUsageService.test.ts`

For each, define an equivalent primitives test (module-level or pipeline-level) to validate behavior with the new runtime.
