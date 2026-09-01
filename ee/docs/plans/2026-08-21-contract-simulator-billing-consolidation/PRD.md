# PRD — Contract Simulator Billing Consolidation

- Slug: `contract-simulator-billing-consolidation`
- Date: `2026-08-21`
- Status: Design complete
- Source: Alga PSA Releases v1.5.0 task `6e0c4c0d-4f22-4246-a1e7-58a0d35d00a8`

## Summary

Replace the contract simulator's parallel billing orchestration with one shared billing-domain calculation pipeline used by both simulation and production invoice generation. Callers supply a normalized, fully resolved calculation input and an explicit execution mode. The shared engine deterministically returns charge lines, discounts, adjustments, tax, totals, explanations, diagnostics, and persistence correlation metadata. Simulation requests `simulate` mode and stops at that result. Production requests `live` mode and preserves its existing transaction, reconciliation, invoice persistence, numbering, audit, idempotency, and event behavior around the shared calculation.

This is a consolidation, not a comparison system. Simulator-specific implementations of charge dispatch, discount/adjustment application, total assembly, and financial line shaping are removed once both callers use the domain pipeline.

## Problem

The codebase shares low-level charge-family functions under `packages/billing/src/lib/billing/compute/`, but still has two higher-level financial implementations:

- Production billing in `BillingEngine.calculateBillingForPreparedPeriod` selects eligible contract lines and recurring periods, resolves pricing and tax context, dispatches charge families, combines charges, applies discounts and adjustments, and produces `IBillingResult`.
- `ee/server/src/lib/billing/simulator/simulateContractScenario.ts` independently generates periods, classifies services, constructs synthetic production-shaped records, invokes charge functions in its own order, reconstructs discount inputs from rendered lines, calculates totals, and maps results into simulator lines.

Sharing arithmetic helpers does not prevent these pipelines from drifting. A new charge family, eligibility rule, effective-date rule, tax behavior, rounding change, or ordering change can still land in one path only. Separate orchestration also forces simulator code to replicate internal production keys and data shapes, as shown by `fixedChargeExplanationKey`, `timeChargeExplanationKey`, synthetic `IClientContractLine`, charge-to-line conversion, and independent `finalizePeriod` totals.

The desired invariant is stronger: equivalent normalized inputs execute the same financial domain function and return the same calculated result. The only difference is whether the caller subsequently performs state-changing work.

## Goals

- Establish one shared contract-billing calculation entry point for simulation and production.
- Separate tenant-scoped loading and production side effects from deterministic pricing, proration, tax, discount, adjustment, rounding, and total calculation.
- Define explicit, versionable input and output contracts with enough charge-level detail for invoice persistence and simulator presentation.
- Make non-persisting execution an explicit mode and capability boundary.
- Preserve production invoice amounts and existing transactional, audit, idempotency, and externally visible behavior.
- Preserve tenant isolation, effective dates, schedules and timing, contract types, currency, tax, adjustments, and integer-minor-unit rounding.
- Delete duplicated financial business-rule implementations from the simulator.
- Prove behavioral parity and prove simulation performs no writes, number allocation, audit/event publication, or other externally visible effects.
- Document where all future contract billing rules must be implemented.

## Non-goals

- Redesigning the simulator UI or scenario authoring experience.
- Changing supported contract types, billing semantics, invoice schemas, tax policy, or rounding policy.
- Replacing production invoice persistence, finalization, credit application, PDF generation, event publication, or audit orchestration.
- Consolidating unrelated project billing, manual invoice authoring, non-contract charges, or invoice rendering unless an adapter is required to preserve contract-invoice output.
- Persisting scenarios or posting simulated output as an invoice.
- Adding comparison-only monitoring instead of removing duplicated rules.
- Migrating or recalculating historical invoices.

## Users and Primary Flows

### Billing administrator — simulation

1. The existing simulator snapshots or builds a scenario and gathers hypothetical activity.
2. A simulation loader validates tenant ownership and resolves the scenario into shared calculation input for each invoice window.
3. The shared engine runs in `simulate` mode and returns calculated billing documents with detailed lines and explanations.
4. The simulator maps only presentation metadata without recalculating money.
5. No mutation-capable port is created or called.

### Billing operator or recurring job — production

1. Existing production orchestration authenticates, resolves the client and execution identity, and opens/pins its transaction as today.
2. A production loader selects due work and resolves it into the same calculation input.
3. The shared engine runs in `live` mode and returns the same calculated document shape used by simulation.
4. Existing orchestration persists charges and invoices, links recurring periods, reconciles sources, allocates numbers, records audit history, and publishes post-commit events.
5. Existing duplicate/idempotency guards remain authoritative.

### Billing feature developer

1. Add or change a financial rule in the shared domain engine or one of its pure charge-family modules.
2. Add shared calculation tests and parity fixtures.
3. Do not add a simulator-only or production-only calculation branch.

## UX / UI Notes

No intentional visual redesign is required. The existing simulator timeline, explanations, comparisons, and invoice preview remain. Its presentation adapter consumes shared calculated lines and totals without deriving net, tax, discounts, adjustments, or totals. Existing diagnostics remain visible; unsupported or invalid normalized inputs produce structured diagnostics/errors instead of silently omitting money.

## Requirements

### Functional Requirements

#### Shared domain contracts

Introduce contracts under `packages/billing/src/lib/billing/domain/` (re-export cross-package UI types from `packages/types` where needed):

```ts
type BillingExecutionMode = "simulate" | "live";

interface ContractBillingCalculationInput {
  schemaVersion: 1;
  execution: {
    mode: BillingExecutionMode;
    tenantId: string;
    calculationId: string;
    asOf: ISO8601String;
  };
  document: {
    clientId: string;
    currencyCode: string;
    invoiceWindow: { start: ISO8601String; endExclusive: ISO8601String };
  };
  client: ResolvedBillingClient;
  obligations: ResolvedContractBillingObligation[];
  activity: ResolvedBillingActivity;
  taxContext: ResolvedChargeTaxContext;
  discounts: ResolvedDiscountInput[];
  adjustments: ResolvedAdjustmentInput[];
}

interface ContractBillingCalculationResult {
  schemaVersion: 1;
  calculationId: string;
  mode: BillingExecutionMode;
  currencyCode: string;
  invoiceWindow: { start: ISO8601String; endExclusive: ISO8601String };
  lines: CalculatedBillingLine[];
  discounts: CalculatedDiscount[];
  adjustments: CalculatedAdjustment[];
  subtotal: number;
  taxTotal: number;
  total: number;
  diagnostics: BillingCalculationDiagnostic[];
}
```

`ResolvedContractBillingObligation` is a discriminated union carrying stable source identity, contract/line identity, charge family, service/configuration, effective pricing schedule, billing timing, service-period selection, coverage/proration inputs, billing-profile attribution, and relevant activity. It must not require the pure engine to query or infer effective rows from global state.

`CalculatedBillingLine` is the single financial line contract. It includes a stable engine-generated `lineKey`, source and obligation references, charge family/type, service identity and description, quantity/duration, unit rate, net amount, tax region/rate/amount, gross amount, currency, service-period boundaries, billing timing, billing-profile attribution, recurring period correlation for live persistence, explanation, and markers.

Money is integer minor units. Date windows keep established half-open `[start, endExclusive)` semantics. Normalization rejects mixed currencies within one document and invalid date or tenant relationships before compute.

#### Shared calculation engine

Add one deterministic entry point:

```ts
calculateContractBilling(
  input: ContractBillingCalculationInput
): ContractBillingCalculationResult
```

It owns the ordered domain pipeline:

1. Validate normalized invariants.
2. Select obligations applicable to invoice and service-period windows.
3. Dispatch fixed, hourly, usage, bucket, product/license recurring quantity, and other in-scope contract families to existing pure compute modules.
4. Preserve supplied bucket period state and return next state when required by multi-period simulation.
5. Apply discounts and adjustments once to canonical charges.
6. Calculate and validate subtotal, tax total, and document total in integer minor units.
7. Return canonical keys, explanations, diagnostics, and persistence metadata.

The engine performs no database/network I/O, accepts no `Knex`, `TaxService`, event bus, numbering service, clock, random UUID generator, or mutable repository, and logs no tenant data. Variable time and calculation identifiers are explicit inputs.

Charge-family functions may remain separate modules, but callers must not orchestrate them directly after migration. They become implementation details of `calculateContractBilling`.

#### Input loaders and adapters

Create two adapters converging on `ContractBillingCalculationInput`:

- Production loader: extracts the read/reconciliation portion of `BillingEngine`, uses tenant-scoped queries, preserves persisted recurring due selections and effective-date rules, resolves profile/tax/pricing context, and supplies real activity and persistence identities.
- Simulation loader: converts scenarios, hypothetical service-period records, and synthetic activity into the same normalized obligations. It may use read-only tenant-scoped lookups but implements no financial formulas or charge ordering.

Where storage shapes differ, normalization occurs in adapters. The domain engine must not accept a broad union of raw DB rows and simulator records that recreates two internal branches.

#### Explicit execution mode and side-effect boundary

`mode` is required and returned for traceability. It is not sprinkled through pricing formulas: equivalent resolved financial inputs calculate identically in either mode.

Mutation-capable operations live after calculation in production orchestration. A production-only commit function accepts a live `ContractBillingCalculationResult` plus execution context and performs existing writes. Simulation has no commit stage and cannot obtain live execution context. Runtime guards reject simulated results passed to persistence; types distinguish a persistable live result where practical.

Simulation must not allocate invoice numbers, provision tax defaults, reconcile time/usage links, mutate bucket usage, insert billing cycles/service periods/charges/invoices, update sources, write audits, publish events, emit billing analytics, generate/deliver invoices, or apply credits.

#### Production preservation

Production keeps its outer transaction and execution identity/idempotency checks. Reads and reconciliation writes currently interleaved with calculation become explicit in production orchestration and remain in the same effective transaction/order unless equivalence tests prove no behavior change.

Invoice creation consumes canonical lines while retaining billing-profile splitting, numbering, persistence correlation, recurring linkage, purchase-order enforcement, tax distribution/finalization, audits, and post-commit publication. The refactor must not weaken duplicate recurring invoice protection or allow a simulation calculation ID to become a live idempotency key.

#### Simulator simplification

Remove simulator-owned financial orchestration from `simulateContractScenario.ts`: independent service-family dispatch, production-record fabrication used only for that dispatch, replicated explanation-key functions, discount reconstruction from rendered lines, and financial total calculation.

Remaining responsibilities are scenario validation/tenant scoping, timeline generation, assumption expansion, normalized input loading, `calculateContractBilling({ mode: "simulate" })`, bucket-state threading using returned domain state, and presentation-only mapping.

### Non-functional Requirements

- Deterministic: serialized normalized input produces the same ordered result regardless of caller.
- Tenant-safe: adapter reads are authenticated-tenant scoped and referenced live identifiers are ownership-validated.
- Pure: calculation has no side effects or hidden reads.
- Compatible: production golden output is unchanged.
- Auditable: lines retain enough source identity for invoice details and recurring linkage.
- Idempotent: production guards retain behavior; repeated simulation is harmless and write-free.
- Extensible: a new contract billing rule has one domain implementation and shared test surface.

## Data / API / Integrations

### Proposed module boundary

```text
packages/billing/src/lib/billing/domain/
  contracts.ts
  validateCalculationInput.ts
  calculateContractBilling.ts
  buildCalculatedLine.ts
  totals.ts
  README.md

packages/billing/src/lib/billing/loaders/
  loadProductionCalculationInput.ts

ee/server/src/lib/billing/simulator/
  loadSimulationCalculationInput.ts
  simulateContractScenario.ts
```

`BillingEngine` may remain the production facade, but its contract path becomes load → shared calculate → existing production commit. Existing `compute/` modules move behind or are imported only by the domain entry point.

No DB migration is expected. If persistence lacks correlation data, extend calculated lines rather than querying again and recalculating during commit.

The simulator action signature may remain stable. `ContractSimulationResult` can remain the UI response, but monetary fields map directly from `ContractBillingCalculationResult`.

## Security / Permissions

- Preserve `billing:read` for simulation and current production invoice-generation authorization.
- Derive tenant from authenticated context; never trust scenario tenant fields.
- Validate every live client, contract, line, service, pricing, profile, location, and tax reference against the authenticated tenant.
- Fail closed on foreign identifiers rather than dropping a line.
- Do not expose persistence ports or live execution tokens through simulator imports or client-callable actions.

## Observability

No new telemetry is required. Existing live invoice audit and event behavior remains. Calculation diagnostics identify invalid/unpriceable obligations without sensitive tenant details. Simulation emits no live billing analytics/events. Tests—not dual-running comparison telemetry—are the parity mechanism.

## Rollout / Migration

1. Characterize current production and simulator behavior with normalized parity fixtures and production goldens.
2. Introduce contracts, canonical line/result builders, and validation behind existing entry points.
3. Move family dispatch and result assembly into `calculateContractBilling`; initially keep compute functions unchanged.
4. Add the production loader and rewire production while retaining the current commit path.
5. Add the simulation loader and rewire the simulator.
6. Delete obsolete simulator financial functions and prevent direct compute-family imports outside the domain module with an architectural test or export boundary.
7. Run focused unit, DB integration, simulator, invoice-generation, typecheck, and UI smoke suites.

No flag or data migration is required because output must be equivalent. Keep changes incremental for development comparison, but do not retain parallel implementation at completion.

## Risks and Mitigations

- Hidden load behavior affects money: capture effective pricing, timing, tax, and reconciliation in characterization tests before extraction.
- A generic input merely relocates branching: require one normalized obligation union; keep raw persistence/scenario shapes in adapters.
- Production commit recalculates fields: enrich `CalculatedBillingLine` until persistence is mapping-only for money.
- Tax defaults provision data: provision only in production orchestration; simulation uses read-only resolved context; both pass identical tax facts to compute.
- Bucket state spans periods: make incoming/outgoing state explicit and parity-test rollover/overage.
- Ordering or keys change UI/persistence behavior: canonicalize in the shared engine and golden-test full line detail, not totals alone.
- Project/non-contract billing increases scope: keep the first boundary contract-specific unless an adapter is required to preserve results.

## Open Questions

- Confirm whether prepaid hour-block charges are reachable from the simulator. If supported, include them in the first normalized obligation union and parity matrix; otherwise document them outside simulator scope without changing production.
- Confirm whether invoice-level tax redistribution after charge persistence can differ from per-line calculated tax. Preserve current finalization either way.
- Confirm which reconciliation mutations must occur before loading versus after successful calculation to preserve lock/order behavior. This affects orchestration only.

## Acceptance Criteria (Definition of Done)

- Production and simulation call the same `calculateContractBilling` entry point for every simulator-supported contract charge family.
- No simulator module directly imports charge-family compute functions or independently applies discounts, adjustments, tax, rounding, or totals.
- The shared engine performs no I/O and accepts all variable state explicitly.
- Contracts include stable keys, source identities, service-period/timing detail, quantities/rates, net/tax/gross, discounts, adjustments, explanations, diagnostics, profile attribution, and persistence correlation.
- Fixed, hourly, usage, bucket/recurring, product/license recurring quantity, proration, effective pricing, tax, discount, adjustment, rounding, mixed-cadence, and boundary-date fixtures produce identical canonical results in both modes.
- Existing production golden fixtures remain equivalent.
- DB-backed tests prove simulation performs zero writes or externally visible side effects, including on failure.
- DB-backed tenant tests reject foreign references without partial results or writes.
- Production persistence, generation, recurring linkage, audit, event, numbering, and idempotency tests pass.
- Duplicate simulator financial helpers are deleted and a boundary test prevents new bypasses.
- `packages/billing/src/lib/billing/domain/README.md` instructs future features to extend the shared calculation layer.
- All features and tests in this plan are implemented and verified.
