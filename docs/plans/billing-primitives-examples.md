## How Manifests and Fact Plans Connect

Each module declares its required Facts/Events and scope contract in a manifest; the host compiles these into a single Fact Plan per run. Use the structure below in each scenario to see how manifests drive inputs and how the plan is executed deterministically.

Use this structure to reason about any scenario:
- Modules: which Producers/Transformers/Validators are involved
- Scope: the JSON shape the Producer expects (declared in its manifest)
- Manifest requirements: which Fact/Event packs, fields, and filters are required
- Fact Plan: the concrete packs and filters the host will fetch
- Program: the ordered stages that will run
- Output: a sample of the Charge IR produced
- Validation: checks applied before persistence
- CLI: `plan-inputs` example to preview the Fact Plan

### Worked Example: Fixed Plan (FMV + Proration)

- Modules
  - Producer: `mod.fixed-fmv@1.0.0`
  - Validator: `mod.money-nonnegative@1.0.0`
- Scope (manifest excerpt)
  - Required fields: `assignment_id`, `plan_id`
  - Optional: `bundle_id`
- Manifest requirements (abridged)
  - facts: `PlanServiceConfigPack{ service_id, quantity, default_rate_cents }` filtered by `plan_id`
  - facts: `PlanFixedConfigPack{ base_rate_cents, enable_proration, alignment }` filtered by `plan_id`
  - facts (optional): `BundlePack{ custom_rate_cents }` filtered by `assignment_id`
  - events: none
- Fact Plan (resolved by host)
  - Packs to fetch for this run:
    - `AssignmentPack` (all active assignments for company + period)
    - `PlanServiceConfigPack(plan_id IN <assignment.plan_id>)` fields: `service_id, quantity, default_rate_cents`
    - `PlanFixedConfigPack(plan_id IN <assignment.plan_id>)` fields: `base_rate_cents, enable_proration, alignment`
    - `BundlePack(assignment_id IN <assignment_id>)` fields: `custom_rate_cents` (only if any assignment has a bundle)
- Program (YAML sketch)
  - stages:
    - `producer: mod.fixed-fmv@1.0.0`
    - `validator: mod.money-nonnegative@1.0.0`
- Output (sample Charge IR)
  - One charge per service with `dimensions: { assignment_id, plan_type: 'fixed', service_id }`
  - `metadata: { fmv_cents, proportion, proration_factor }`
- CLI plan preview
  - `alga-billing plan-inputs --company C123 --period 2025-01-01:2025-01-31`
  - Output (abridged):
    - `PlanServiceConfigPack` fields `[service_id,quantity,default_rate_cents]` filter `{plan_id: [P1,P2]}`
    - `PlanFixedConfigPack` fields `[base_rate_cents,enable_proration,alignment]` filter `{plan_id: [P1,P2]}`
    - `BundlePack` fields `[custom_rate_cents]` filter `{assignment_id: [A1,A3]}` (optional)

### Cheat Sheet: Scenarios → Fact Packs

- Fixed FMV + proration: AssignmentPack, PlanServiceConfigPack, PlanFixedConfigPack, (BundlePack optional)
- Hourly (min/round, user-type): AssignmentPack, PlanServiceConfigPack (hourly ids), HourlyConfigPack, UserTypeRatesPack, TimeEntriesPack
- Usage (tiers/min): AssignmentPack, PlanServiceConfigPack (usage ids), UsageConfigPack, RateTiersPack, UsageRecordsPack
- Bucket/Retainer (overage): AssignmentPack, PlanServiceConfigPack (bucket ids), BucketStatePack, TimeEntriesPack
- Bundles (flat plan custom rate): BundlePack + Transformer only (consumes charges from Producers)
- Discounts/Caps: DiscountPolicyPack (transformers consume ChargeSet)
- Out-of-hours surcharge: CalendarPack + (Hourly Producer) or surcharge Transformer

# Billing Primitives Examples: Scenarios → Scopes, Dimensions, Modules

This document shows how common and advanced billing scenarios map onto the primitive model: Producers, Transformers, Validators operating on the Charge IR.

Conventions used below:
- Scope: the opaque target the host passes a Producer (e.g., a specific assignment).
- Dimensions: tags attached to charges for targeting/grouping.
- Facts/Events: required inputs from the host.
- Modules: Producers/Transformers/Validators applied.

## 1) Fixed Plan: FMV Allocation + Proration

- Scope: `{ assignment_id }` (host chooses an assignment per company_billing_plan)
- Facts: plan services (service_id, default_rate_cents, quantity), plan proration policy
- Events: none
- Dimensions: `assignment_id`, `plan_type=fixed`, optionally `service_id`, `category`
- Modules:
  - Producer `fixed-fmv` → emits one charge per service with proportion + proration in `metadata`
  - Validator `money-nonnegative`
- Output: detailed charges with `metadata: { fmv_cents, proportion, proration_factor }`

## 2) Fixed Plan in Bundle with Custom Rate

- Scope: `{ assignment_id, bundle_id }`
- Facts: bundle association, `custom_rate_cents`
- Modules:
  - Producer `fixed-fmv` (as above)
  - Transformer `bundle-flat-rate` → ensures the plan’s total equals `custom_rate_cents` and groups charges under the bundle; optionally bypasses per‑service allocations per policy
- Dimensions added/used: `bundle_id`, `bundle_name`

## 3) Hourly Plan: Min Time + Rounding + User-Type Rates

- Scope: `{ assignment_id }`
- Facts: hourly config (min billable minutes, round up to nearest), user_type_rates
- Events: approved time entries (with user_type, service_id)
- Dimensions: `assignment_id`, `plan_type=hourly`, `user_type`, `service_id`
- Modules:
  - Producer `hourly` → applies min + rounding, picks rate from user_type or default
  - Validator `time-entry-ref-integrity` (ensures `input_refs` exist and are unique)

## 4) Usage Plan: Tiers + Min Usage

- Scope: `{ assignment_id }`
- Facts: usage config (min usage, enable tiers), rate tiers
- Events: usage records for period
- Dimensions: `assignment_id`, `plan_type=usage`, `service_id`
- Modules:
  - Producer `usage-tiers` → computes tiered totals; records tier path in `metadata`
  - Validator `tiers-well-formed`

## 5) Bucket/Retainer: Overage Billing

- Scope: `{ assignment_id }`
- Facts: bucket policy (total_hours, overage_rate_cents, rollover), bucket balance
- Events: approved time entries mapping into the bucket
- Dimensions: `assignment_id`, `plan_type=bucket`, `bucket_id`
- Modules:
  - Producer `bucket-overage` → calculates used vs allowance and emits overage charges
  - Validator `bucket-balance-nonnegative`

## 6) Combination Plan: "Spend X on Category A → Y% off Category B"

- Scope: multiple assignments (host may feed all relevant scopes in the same Program)
- Facts: category mappings per service
- Events: time/usage as applicable
- Dimensions: `category`, `assignment_id`
- Modules:
  - Producers: the normal plan Producers for A and B
  - Transformer `category-coupons` → inspects aggregate spend on A and emits discount charges targeting B (negative net)
  - Validator `discount-bounds`

## 7) Category or Plan Cap (Monthly Maximum)

- Scope: all assignments in period
- Facts: cap policy (per category or per plan)
- Dimensions: `category` or `assignment_id`
- Modules:
  - Producers: normal calculation
  - Transformer `cap-total` → trims or emits offsetting negative charges to enforce cap; records `cap_id` in `metadata`
  - Validator `cap-consistency`

## 8) First N Free Across a Plan Type

- Scope: all assignments with `plan_type=usage`
- Facts: promo policy `{ plan_type: 'usage', first_n_units: 100 }`
- Events: usage records
- Dimensions: `plan_type`, `service_id`
- Modules:
  - Producer `usage-tiers`
  - Transformer `first-n-free` → converts first N units into a discount line or adjusts net of early charges

## 9) Bundle Grouping and Labeling

- Scope: all assignments carrying `bundle_id`
- Facts: bundle metadata
- Modules:
  - Transformer `bundle-grouping` → ensures charges are labeled/grouped with `dimensions.bundle_id`/`bundle_name`; may add a rollup line item

## 10) Tax Handling (V1 Host-Side)

- Producers/Transformers set `is_taxable` and optional `tax_region_hint`.
- Host applies tax via TaxService per line and persists.
- Validator `taxable-lines-complete` (host or module): ensures taxable lines have necessary hints.

## 11) Multi-Currency (Optional)

- Producers emit `currency_code` aligned with company policy; host handles FX consistency or rejects mixing per configuration.

## 12) Manual Discounts and Adjustments

- Scope: none (global)
- Modules:
  - Transformer `manual-adjustments` → converts operator-input adjustments into normalized discount charges with `dimensions: { adjustment_id }`
  - Validator `manual-adjustments-audit`


## Binding Examples

These examples show how bindings resolve `plan_type`, `plan_id`, and `bundle_id` into concrete modules and how transformers are applied globally.

### Binding registry (conceptual JSON)

```json
{
  "bindings": [
    { "scope": {"plan_type": "fixed"},  "module_id": "mod.fixed-fmv",    "version": "^1" },
    { "scope": {"plan_type": "hourly"}, "module_id": "mod.hourly",       "version": "^1" },
    { "scope": {"plan_type": "usage"},  "module_id": "mod.usage-tiers",  "version": "^1" },
    { "scope": {"plan_type": "bucket"}, "module_id": "mod.bucket-overage","version": "^1" },

    // Per-plan override: use a tenant-custom fixed calculator for plan P-ENTERPRISE
    { "scope": {"plan_id": "P-ENTERPRISE"}, "module_id": "mod.fixed-fmv-enterprise", "version": "1.2.x", "priority": 100 }
  ],
  "global": {
    "transformers": [
      // Enforce bundle custom_rate on any charges that carry bundle_id
      { "module_id": "mod.bundle-flat-rate", "version": "^1", "when": {"has_dimension": "bundle_id"} },
      // Apply tenant-wide promotions
      { "module_id": "mod.category-coupons", "version": "^1", "args": {"policy_ref": "promo-2025-Q1"} },
      // Enforce monthly caps from tenant policy
      { "module_id": "mod.cap-total", "version": "^1", "args": {"policy_ref": "caps-default"} }
    ],
    "validators": [
      { "module_id": "mod.money-nonnegative", "version": "^1" }
    ]
  }
}
```

### Program (pipeline) sketch

```yaml
stages:
  # Producers resolved per assignment via bindings
  - producer: mod.fixed-fmv@1.x
  - producer: mod.hourly@1.x
  - producer: mod.usage-tiers@1.x
  - producer: mod.bucket-overage@1.x

  # Global transformers
  - transformer: mod.bundle-flat-rate@1.x
  - transformer: mod.category-coupons@1.x
  - transformer: mod.cap-total@1.x

  # Validators
  - validator: mod.money-nonnegative@1.x
```

Notes:
- The host selects one Producer per assignment scope using the first matching binding (highest priority wins).
- Transformers/Validators run over the unified ChargeSet after all Producers finish.

## Per-Scenario Scope Schemas (Producer)

Scope schemas describe what the Producer expects from the host for each assignment. Transformers/Validators generally run without a per-assignment scope.

1) Fixed Plan (FMV + Proration)
```json
{"type":"object","required":["assignment_id","plan_id"],"properties":{"assignment_id":{"type":"string"},"plan_id":{"type":"string"},"bundle_id":{"type":["string","null"],"default":null}}}
```

2) Fixed in Bundle (Custom Rate)
```json
{"type":"object","required":["assignment_id","plan_id"],"properties":{"assignment_id":{"type":"string"},"plan_id":{"type":"string"},"bundle_id":{"type":"string"}}}
```

3) Hourly (Min/Round, User-Type Rates)
```json
{"type":"object","required":["assignment_id","plan_id"],"properties":{"assignment_id":{"type":"string"},"plan_id":{"type":"string"}}}
```

4) Usage (Tiers/Min)
```json
{"type":"object","required":["assignment_id","plan_id"],"properties":{"assignment_id":{"type":"string"},"plan_id":{"type":"string"}}}
```

5) Bucket/Retainer (Overage)
```json
{"type":"object","required":["assignment_id","plan_id"],"properties":{"assignment_id":{"type":"string"},"plan_id":{"type":"string"}}}
```

6) Combination Plan (Cross-Category Discount)
- Producers (A and B) use the standard assignment scope above.
- Transformer is global; no per-assignment scope.

7) Category/Plan Cap
- Producers use standard assignment scope.
- Transformer is global; no per-assignment scope.

8) First N Free (Plan Type Wide)
- Producers use standard assignment scope for `plan_type=usage`.
- Transformer is global; no per-assignment scope.

9) Bundle Grouping/Labeling
- Transformer only; no per-assignment scope (operates on charges that have `dimensions.bundle_id`).

10) Tax Handling (Host-Side in V1)
- No Producer scope change; host applies tax after transformers.

11) Multi-Currency (Optional)
- Producers use standard assignment scope; `currency_code` is part of Company Context.

12) Manual Discounts/Adjustments
- Transformer only; no per-assignment scope.
