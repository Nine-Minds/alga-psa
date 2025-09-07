# Billing Primitives Overhaul: Rationale and Design Overview

## Why

- Empower flexibility: let MSPs compose and customize billing logic without waiting on core releases.
- Avoid leakage: do not hard‑code current plan/bundle concepts into the execution model; keep the core generic and future‑proof.
- Deterministic and safe: pure compute in a WASM sandbox with strict limits, reproducible inputs, and audit trails.
- Incremental adoption: support today’s plans/bundles as shipped “templates”, while enabling completely custom logic.

## Core Concept: A Small Set of Primitives

We define a minimal, durable set of abstractions for a billing runtime. Current concepts like “plans” and “bundles” are implemented on top of these primitives, not baked into them.

### 1) Charge IR (Intermediate Representation)

Normalized line items produced/modified by modules. All money is integer cents.

- Required fields:
  - `description` (string)
  - `quantity` (number, integer or decimal as policy allows)
  - `unit_price_cents` (integer)
  - `net_amount_cents` (integer; may be negative for discounts)
  - `currency_code` (string, e.g., "USD")
  - `is_taxable` (boolean)
- Optional hints (not binding on host):
  - `tax_region_hint` (string | null)
- Dimensions (tags):
  - `dimensions: Record<string, string>` — arbitrary key/value identifiers used for grouping, targeting, or reporting (e.g., `assignment_id`, `plan_type`, `bundle_id`, `service_id`, `category`, `user_type`, `work_item_type`).
- Provenance/Audit:
  - `source_module` (module_id@version)
  - `source_scope` (opaque descriptor of the scope that produced the charge)
  - `input_refs: string[]` (IDs of referenced events/items like time entry IDs, usage IDs)
  - `metadata: Record<string, unknown>` (explain decisions: FMV proportions, proration factor, tier path, rule IDs)

Notes:
- The IR deliberately avoids hard requirements like `service_id` or `plan_id` to keep the core generic; those become dimensions when relevant.
- Host guarantees final validation and persistence mapping to invoice tables.

### 2) Facts & Events IR (Inputs)

All data is provided by the host; modules do not access storage or network.

- Facts (snapshots): catalog entries, rate cards, assignments, bundle associations, bucket balances, policy flags, user types, etc.
- Events (time‑bound records): time entries, usage records, license activations, manual adjustments, custom events.
- Extensible typing: core schemas plus tenant‑specific custom fields allowed; unknown fields are preserved for module consumption.

### 3) Context IR

- `CompanyContext`: `tenant_id`, `company_id`, `is_tax_exempt`, `default_tax_region`, `currency_code`.
- `BillingPeriod`: `start_date`, `end_date`, `billing_cycle`.
- Policies: rounding, FX handling (if multi‑currency), feature flags.
- Determinism: `seed`, `now` (if required), module execution limits.
- Scopes: a list of opaque “targets” the host will pass to Producers (e.g., one scope per plan assignment). The runtime does not mandate a “plan” concept.

### 4) Module Types (Compositional)

- Producer(scope, context, facts, events) → Charge[]
  - Emits charges for a given scope. “Plan calculators” are just Producers where the scope points to a plan assignment.
- Transformer(charges, context, facts) → Charge[]
  - Maps/filters/aggregates charges. Implements bundles, caps, promotions, cross‑plan discounts, grouping, and custom reallocations.
- Validator(charges, context) → { ok|fail, warnings[], normalizedCharges? }
  - Enforces invariants: e.g., required dimensions, non‑negative totals unless discount, currency consistency.
- Program (pipeline): an ordered set of stages (Producers/Transformers/Validators) configured per tenant with priorities and optional dependencies.

## Orchestration and Responsibilities (Host)

- Data prep: fetch facts/events, build contexts and scopes deterministically.
- Module registry/bindings: map scopes (e.g., plan_type, plan_id, bundle_id, tenant) to module@version; respect allowlists/signatures.
- Execution: run WASM modules with strict CPU/memory limits; ensure deterministic ordering and JSON I/O.
- Tax: applied via a Tax Transformer (V1) using Tax Fact Packs; host handles final rounding/persistence and invoice emission.
- Audit: log `module_id/version/hash`, input hash, outputs snapshot, duration, warnings; store on invoice details and in a `billing_executions` table.
- Release gating: feature flags per tenant if desired (no legacy coupling assumed).

## Module Storage and Loading

- Storage abstraction: use `StorageService` (`server/src/lib/storage/StorageService.ts`) and `StorageProviderFactory` for provider‑agnostic storage (local filesystem or S3‑compatible such as MinIO in on‑prem/EE).
- Artifacts: store compiled Wasm modules (Javy) as immutable blobs. Persist metadata in DB (e.g., `module_id`, `version`, `sha256`, `size`, provider path).
- Access: orchestrators read on-demand via `StorageService` (private/VPC endpoints for remote providers). No CDN/CloudFront is needed since execution is server‑side.
- Caching: not required initially; modules are fetched on demand. If needed, an LRU/disk cache can be introduced later without changing module contracts.

## Security and Determinism

- WASM sandbox without FS/network; timeouts and memory caps per module.
- Integer cents only; no floating math; deterministic sorting of inputs.
- No Date.now/Math.random inside modules; host supplies a `seed` or `now` when needed.
- Module signing and tenant allowlists; pinned versions per binding; recorded hashes for replay.

## Extensibility Without Leakage

- Current constructs (plans, bundles, categories) only appear as dimensions or scope payloads; the core runtime doesn’t require or know them.
- New billing models = new Producers/Transformers consuming the same IRs.
- Custom discount rules are Transformers producing negative charges or adjusting nets, targeted by dimensions.
- Bundles become a Transformer that groups by `bundle_id` and enforces bundle semantics (e.g., flat plan custom_rate) — fully replaceable.

## Mapping Today’s System Onto Primitives

- Fixed Plans (FMV + proration): Producer; uses facts (plan services, quantities, default rates); `metadata` carries FMV/proportions/proration.
- Hourly Plans: Producer; uses hourly config, user‑type rates, min/round; events are approved time entries.
- Usage Plans (tiers/min): Producer; uses tier tables and usage events.
- Buckets/Retainers: Producer; facts include bucket balance and policy; emits overage charges.
- Bundles: Transformer; enforces `bundle_billing_plans.custom_rate`, grouping, and labeling; can override allocation strategy.
- Discounts: Transformers; threshold/cap/promotions applied against dimensions; emit negative lines or adjust nets.
- Tax: V1 includes a Tax Transformer that consumes Tax Fact Packs and emits tax charges/breakdowns; modules set `is_taxable`/`tax_code`/`tax_region_hint` where relevant.

## Module Registry and Bindings

- `billing_scripts`: store signed WASM blobs + metadata (name, language, version, hash, signature).
- `billing_script_bindings`: map scope selectors (tenant, plan_type, plan_id, bundle_id) to a module version with priority.
- `billing_executions`: record per‑run inputs/outputs hashes and timing; link to invoice.

## Adoption Strategy

- Start with official templates: Fixed Producer, Hourly Producer, Usage Producer, Bucket Producer, Bundle Transformer, Standard Discounts.
- Default module target: Javy (JavaScript/TypeScript compiled to Wasm/QuickJS). Provide a JS/TS SDK with helpers for FMV allocation, proration, tier evaluation, rounding, and safe money operations.
- CLI for build/sign/publish and local dry-run against fixtures; run vitest directly on JS and integration on compiled Wasm.
- Feature-flagged rollout per tenant as needed.

## Module Target: Javy (JavaScript/TypeScript → Wasm)

- Author modules in TypeScript or JavaScript.
- Compile with Javy to Wasm (QuickJS runtime embedded) and execute in the orchestrator with CPU/memory limits.
- Determinism: shim Date/Math.random; pass `now`/`seed` via Context; freeze intrinsics; integer cents money ops.
- Performance: on-demand fetch/instantiate per use is acceptable for expected size/volume. Revisit caching/instance reuse if measurements warrant it.

## Out of Scope

- Direct data access from modules (WASM remains pure compute).
- Multi‑currency conversions (stay host‑side policy if needed).

## Benefits Summary

- Flexibility: any plan/bundle/discount model can be composed via Producers/Transformers over a stable IR.
- Safety: sandboxed execution with guardrails and signatures.
- Observability: deterministic runs with complete execution records.
- Future‑proofing: no tight coupling to today’s schema or taxonomy.


## Module Manifests (Declare-What-You-Use)

Each module version ships with a manifest so the host knows which inputs to fetch and how to wire scopes. This prevents over-fetching and makes planning deterministic.

- Identity
  - `name`: human-readable
  - `module_id`: immutable identifier
  - `version`: semver
  - `type`: `producer | transformer | validator`
- Scope contract
  - `scope.schema`: JSON-Schema for expected fields (e.g., `assignment_id`, optional `bundle_id`)
  - `scope.version_range`: acceptable schema versions
- Requirements
  - `requires.facts[]`: list of Fact Pack requirements
    - `kind`: e.g., `PlanServiceConfigPack`
    - `version_range`: semver range
    - `fields`: needed field names
    - `filters`: declarative constraints (e.g., `company_id`, `period`)
    - `optional`: boolean (default false)
  - `requires.events[]`: same structure for event packs (e.g., `TimeEntriesPack`)
- Policies & assumptions (optional)
  - `policies`: rounding/proration expectations if the module depends on specific modes
- Outputs & invariants (optional)
  - `emits.dimensions_default`: dimensions it will set on all charges
  - `invariants[]`: assertions the Validator or host can enforce (e.g., "no negative net except discounts")
- Compatibility
  - `program_version_range`: compatible Program schema range

Example (abridged):

```json
{
  "name": "fixed-fmv",
  "module_id": "mod.fixed-fmv",
  "version": "1.0.0",
  "type": "producer",
  "scope": {
    "schema": {
      "type": "object",
      "required": ["assignment_id", "plan_id"],
      "properties": {
        "assignment_id": {"type": "string"},
        "plan_id": {"type": "string"},
        "bundle_id": {"type": ["string", "null"]}
      }
    },
    "version_range": ">=1.0.0 <2.0.0"
  },
  "requires": {
    "facts": [
      {"kind": "PlanServiceConfigPack", "version_range": ">=1", "fields": ["service_id", "quantity", "default_rate_cents"], "filters": {"plan_id": "${scope.plan_id}"}},
      {"kind": "PlanFixedConfigPack", "version_range": ">=1", "fields": ["base_rate_cents", "enable_proration", "alignment"], "filters": {"plan_id": "${scope.plan_id}"}, "optional": false},
      {"kind": "BundlePack", "version_range": ">=1", "fields": ["custom_rate_cents"], "filters": {"assignment_id": "${scope.assignment_id}"}, "optional": true}
    ],
    "events": []
  },
  "emits": {"dimensions_default": {"plan_type": "fixed"}},
  "program_version_range": ">=1.0.0 <2.0.0"
}
```

## Core Fact Packs (V1)

- CompanyPack
  - Fields: `tenant_id`, `company_id`, `company_name`, `is_tax_exempt`, `default_tax_region`, `currency_code`
- AssignmentPack
  - Fields: `assignment_id`, `company_id`, `plan_id`, `start_date`, `end_date`, `billing_cycle`, `bundle_id?`, `bundle_name?`
- CatalogPack
  - Fields: `service_id`, `service_name`, `default_rate_cents`, `category_id`, `tax_rate_id?`
- PlanFixedConfigPack
  - Fields: `plan_id`, `base_rate_cents`, `enable_proration`, `alignment`
- PlanServiceConfigPack
  - Fields: `plan_id`, `service_id`, `configuration_type`, `quantity`, `custom_rate_cents?`, config-ids for hourly/usage/bucket
- HourlyConfigPack
  - Fields: `config_id`, `minimum_billable_minutes`, `round_up_to_minutes`
- UserTypeRatesPack
  - Fields: `config_id`, `user_type`, `rate_cents`
- UsageConfigPack
  - Fields: `config_id`, `minimum_usage`, `enable_tiered_pricing`
- RateTiersPack
  - Fields: `config_id`, `min_quantity`, `max_quantity?`, `rate_cents`
- TimeEntriesPack (events)
  - Fields: `entry_id`, `user_id`, `user_type`, `service_id`, `start_time`, `end_time`, `approved`, `billable`
  - Filters: `company_id`, within `period`, `approved=true`, `billable=true`
- UsageRecordsPack (events)
  - Fields: `usage_id`, `service_id`, `usage_date`, `quantity`, `invoiced=false`
  - Filters: `company_id`, within `period`, `invoiced=false`
- BucketStatePack
  - Fields: `assignment_id`, `total_hours`, `hours_used`, `rollover_allowed`, `overage_rate_cents`
- BundlePack
  - Fields: `bundle_id`, `assignment_id`, `bundle_name`, `custom_rate_cents?`
- DiscountPolicyPack
  - Fields: policy objects for thresholds, caps, first-N-free rules
- CalendarPack
  - Fields: business calendars, SLA windows, OOH/holiday rules

Notes:
- Packs are versioned; modules declare ranges. Host selects compatible versions or fails with a precise error.

## Fact Planner (Host)

- Input: Program pipeline, bindings → resolves concrete module versions → loads manifests
- Process: Unions required packs, collapses overlapping field sets, enforces version compatibility, builds filters per pack
- Output: Fact Plan (query checklist) with pack kinds, fields, filters, and estimated volumes
- Failure modes: Missing pack support, incompatible version ranges, unknown scope fields → fast, actionable errors
