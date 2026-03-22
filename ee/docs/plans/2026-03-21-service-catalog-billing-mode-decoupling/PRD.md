# PRD — Service Catalog Billing Mode Decoupling

- Slug: `service-catalog-billing-mode-decoupling`
- Date: `2026-03-21`
- Status: Draft (Hard Cutover)

## Summary
Decouple service identity from billing behavior so the same catalog service can be billed differently per contract line (`fixed`, `hourly`, `usage`) while still supporting default pricing. Remove hard gating that currently treats `service_catalog.billing_method` as eligibility truth, enforce allocation by contract-line service membership, and make non-contract time/usage explicit instead of silently sweeping null-linked entries into arbitrary contract lines.

## Problem
- Today, contract authoring gates services by `service_catalog.billing_method`, so a service marked `hourly` cannot be added under fixed, even when the business contract requires fixed pricing for that same service.
- Billing engine still includes `contract_line_id IS NULL` time/usage in each contract-line calculation pass, which can cause ambiguous or duplicate allocation behavior.
- API and UI surfaces conflate catalog metadata with billing behavior and expose `billing_method` as if it is immutable service identity.
- Product teams need the model to be:
1. `item_kind` describes *what it is* (`service` vs `product`).
2. contract line mode describes *how it is billed*.
3. catalog can provide optional mode-specific defaults.

## Goals
- Allow any `item_kind='service'` service to be added to fixed/hourly/usage contract-line contexts.
- Make contract-line context the authoritative billing mode, not catalog `billing_method`.
- Preserve defaulting ergonomics via mode-specific default prices/rates in catalog metadata.
- Ensure time/usage allocation only bills through valid matching contract-line services.
- Treat unresolved (non-contract) time/usage as explicit work, not implicit fallback.
- Keep existing invoice persistence semantics intact (including mixed assignment support), while giving deterministic allocation.

## Non-goals
- Replacing the full invoice data model.
- Reworking tax/export/GL behavior.
- Replacing service types taxonomy (`custom_service_type_id` remains identity taxonomy).
- Full redesign of manual invoice creation UX.
- Changing permission model for service catalog CRUD.

## Users and Primary Flows
- Billing admin configures a catalog service once and optionally sets default prices per billing mode.
- Contract author creates/edits contract lines and can add any service under fixed/hourly/usage sections; defaults prefill but remain editable.
- Technician enters time with service; explicit contract-line assignment is preferred but not required.
- Billing engine allocates approved uninvoiced records:
1. explicit line assignment first,
2. unique service-based contract match second,
3. unresolved remains non-contract work.
- Invoicing user can bill contract-backed work and non-contract work separately, and optionally combine only when compatible.

## UX / UI Notes
- Contract wizard/service pickers:
1. remove hard `billingMethods` gating for service items by section,
2. still gate `item_kind` where needed (`service` vs `product`).
- In each section, show “Default for this mode” when a mode-specific default exists.
- Contract-line service forms should display effective mode + source of default (`catalog default`, `contract override`, `none`).
- Time entry contract info banner should clearly show:
1. assigned contract line,
2. uniquely inferred contract line,
3. unresolved non-contract billing path.
- Automatic invoicing grouped UI should represent non-contract candidates as first-class items.

## Requirements

### Functional Requirements
### L0 Objective
Establish a single behavioral rule: **service identity is catalog-level; billing mode is contract-line-level**.

### L1.A Data Model and Vocabulary
- Keep `item_kind` as identity discriminator.
- Introduce a mode-specific default-rate structure keyed by:
1. `service_id`,
2. `billing_mode`,
3. `currency_code`,
4. tenant.
- Canonicalize vocabulary to `fixed | hourly | usage` and remove active `per_unit` writes.
- Do not preserve compatibility reads for legacy fields after cutover migration is applied.

### L1.B Contract Authoring and Mutation
- Wizard/template authoring must no longer reject services based on catalog `billing_method`.
- Server-side submission validation must enforce contract context requirements, not catalog-method matching.
- Adjacent APIs (`add service to contract line`, preset/template line service actions) must align with same policy.

### L1.C Pricing Defaults
- Default selection precedence for contract-line service config:
1. explicit contract override,
2. catalog mode default for contract currency,
3. no default (user must enter/confirm).
- Defaults must be applied consistently in wizard, template wizard, and line-edit screens.

### L1.D Time/Usage Allocation
- Replace unconditional null-line fallback with service-aware allocation.
- Allocation precedence:
1. explicit `contract_line_id`,
2. unique eligible active contract-line service match for `(client, service, date)`,
3. unresolved non-contract.
- Never allocate a record to a contract line that does not include the record’s service.

### L1.E Invoicing Behavior
- Non-contract approved billable records must be selectable as explicit invoice candidates.
- Contract-backed and non-contract candidates can be generated separately.
- Combination is allowed only under compatibility rules (client/window/currency/tax/export/PO scope).

### L1.F API/Schema Compatibility
- Hard-cutover API contracts and remove legacy alias fields (including `service_type` compatibility fields).
- Update Zod/api/interface contracts that currently require catalog `billing_method` as behavioral truth.

### L1.G Migration and Backfill
- Backfill mode defaults from current catalog data into new default-rate structure.
- Normalize `per_unit` legacy values to `usage` in writes and validation.
- Migration is one-way; no dual-read/dual-write compatibility path is retained.

### Non-functional Requirements
- Deterministic allocation: same input set must always produce same contract/non-contract partition.
- No regression in existing cadence/materialization paths introduced by this plan.
- DB-backed integration tests required for new reads/writes and migration backfill behavior.
- No hidden fallback paths that silently remap unresolved records.

## Data / API / Integrations
- Primary touched areas:
1. `packages/billing/src/actions/contractWizardActions.ts`
2. `packages/billing/src/actions/contractLineServiceActions.ts`
3. `packages/billing/src/lib/billing/billingEngine.ts`
4. `packages/scheduling/src/actions/timeEntryCrudActions.ts`
5. `packages/billing/src/actions/serviceActions.ts`
6. `server/src/lib/api/services/ServiceCatalogService.ts`
7. `server/src/lib/api/services/ProductCatalogService.ts`
- Add/update schema contracts:
1. `server/src/lib/api/schemas/serviceSchemas.ts`
2. `server/src/lib/api/schemas/productSchemas.ts`
3. `server/src/lib/api/schemas/financialSchemas.ts`
4. `server/src/lib/api/schemas/contractLineSchemas.ts`
- Identity handling alignment:
1. assignment-scoped IDs already used in clients stack,
2. billing-engine readers must handle/parse correctly where needed.

## Security / Permissions
- No new permissions introduced.
- Existing service catalog and contract authoring permissions remain unchanged.

## Observability
- Not adding new telemetry scope in this plan.
- Error messages for unresolved allocation must remain actionable and non-ambiguous.

## Rollout / Migration
- Phase 0: apply one-way schema migration/backfill and canonical value normalization.
- Phase 1: update wizard/picker/API validations to contract-context semantics.
- Phase 2: update engine allocation to service-aware matching and explicit non-contract outputs.
- Phase 3: land strict schema/API hard cutover and remove all compatibility branches in same release.

## Execution Order
### Wave 0 — Schema and Canonicalization Gate
- Scope: `F001-F003`.
- Entry criteria:
1. migration scripts authored,
2. backfill mapping rules documented.
- Exit criteria:
1. canonical vocabulary enforced in writes,
2. mode-default storage created and populated,
3. migration tests green (`T001-T005`).
- Stop-the-line conditions:
1. residual `per_unit` write paths remain,
2. backfill cannot produce complete defaults for active services.

### Wave 1 — Contract Authoring Cutover
- Scope: `F004-F017`.
- Depends on: Wave 0.
- Entry criteria:
1. schema is migrated in dev/test DB,
2. default resolver available to wizard/form code.
- Exit criteria:
1. wizard/template and line service actions use contract-context validation only,
2. no catalog-method eligibility gates remain in these paths,
3. prefill behavior is deterministic for fixed/hourly/usage,
4. tests green (`T006-T027`).
- Stop-the-line conditions:
1. contract creation/edit can still fail solely due to catalog `billing_method`,
2. wizard resume loses or mutates selected service/rate state.

### Wave 2 — Engine Allocation Integrity
- Scope: `F018-F025`.
- Depends on: Wave 1.
- Entry criteria:
1. contract authoring can produce decoupled line/service mappings reliably.
- Exit criteria:
1. unconditional null-line fallbacks removed for time and usage,
2. service-membership-constrained allocation enforced,
3. pricing and bucket regressions absent,
4. tests green (`T028-T040`).
- Stop-the-line conditions:
1. same unassigned record can be billed by multiple lines,
2. rounding/minimum/overtime/tiering regressions are detected.

### Wave 3 — Invoicing Candidate and Generation Behavior
- Scope: `F026-F032`.
- Depends on: Wave 2.
- Entry criteria:
1. engine returns deterministic contract/non-contract partitioning.
- Exit criteria:
1. non-contract candidates appear as first-class due work,
2. separate vs combined generation works with compatibility guards,
3. preview/generate summary accuracy verified,
4. tests green (`T041-T049`).
- Stop-the-line conditions:
1. non-contract work is invisible/inaccessible,
2. incompatible mixed selections combine incorrectly.

### Wave 4 — API/Schema/Downstream Hard Cutover
- Scope: `F033-F043`.
- Depends on: Wave 3.
- Entry criteria:
1. core behavior is stable in billing flows.
- Exit criteria:
1. all affected APIs/schemas/interfaces reflect decoupled semantics,
2. no legacy alias contracts retained,
3. onboarding/settings/usage tracking callers aligned,
4. tests green (`T050-T060`).
- Stop-the-line conditions:
1. any consumer still requires legacy alias payloads,
2. compile/schema suites fail due to mixed old/new contracts.

### Wave 5 — Final Debt Purge and Guard Rails
- Scope: `F044`.
- Depends on: Wave 4.
- Entry criteria:
1. all functional paths migrated.
- Exit criteria:
1. compatibility/fallback branches removed,
2. static guards prevent reintroduction,
3. e2e bootstrap no longer injects stale constraints,
4. final DB-backed sanity run passes,
5. tests green (`T061-T066`).
- Stop-the-line conditions:
1. any lingering compatibility branch is still executed in production paths,
2. static guards fail to catch reintroduced legacy gates/fallbacks.

## Open Questions
- Resolved (2026-03-21): Canonical billing mode vocabulary is `fixed | hourly | usage`; `per_unit` is legacy compatibility only.
- Resolved (2026-03-21): Source of billing behavior truth is contract-line context; catalog stores defaults, not enforcement.
- Resolved (2026-03-21): Products remain `item_kind='product'`; product billing behavior is handled in product line flows and not used to gate service line eligibility.
- Resolved (2026-03-21): Non-contract time/usage must be first-class selectable invoice candidates, not implicit sweep-in.
- Resolved (2026-03-21): No compatibility compromises: no dual-read/dual-write and no transitional alias fields retained post-migration.

## Acceptance Criteria (Definition of Done)
- A single service can be added under fixed or hourly contract sections without catalog-method rejection.
- Wizard/template and line-edit actions no longer hard-fail on catalog `billing_method` mismatch for services.
- Mode-specific defaults prefill rates in each contract-line context and remain editable.
- Billing engine no longer uses unconditional `contract_line_id IS NULL` fallback in a way that can multi-claim records.
- Unresolved approved billable time/usage appears as explicit non-contract invoice candidates.
- Users can invoice contract-backed and non-contract work separately; combined generation only occurs when compatibility checks pass.
- API schemas/interfaces are consistent with decoupled semantics and tests are green.
- Legacy alias fields and compatibility branches are removed in the same cutover release.
- Migration/backfill tests prove existing data remains billable and deterministic post-cutover.
