# Scratchpad — Contract Simulator Billing Consolidation

- Plan slug: `contract-simulator-billing-consolidation`
- Created: `2026-08-21`
- Source task: `6e0c4c0d-4f22-4246-a1e7-58a0d35d00a8`

## Decisions

- (2026-08-21) Consolidate at the document/domain pipeline, not only charge-family arithmetic. Existing shared `compute*` functions do not prevent orchestration drift.
- (2026-08-21) Keep one normalized input model. Production rows and simulator records are converted by separate loaders and do not remain alternate calculation branches.
- (2026-08-21) Make execution mode explicit at the calculation entry point/result, but keep formulas mode-independent. Mode governs the capability boundary.
- (2026-08-21) Keep persistence as a production-only commit stage so transaction, audit, and idempotency behavior remains.
- (2026-08-21) Generate canonical line keys and explanations in the domain engine; callers must not replicate private derivation.
- (2026-08-21) Keep project billing, non-contract charges, and manual invoices out of initial consolidation unless required to preserve contract results.
- (2026-08-21) Treat full ordered line detail—not totals alone—as the parity contract.

## Discoveries / Constraints

- (2026-08-21) `packages/billing/src/lib/billing/compute/` has shared pure functions for fixed, hourly, usage, bucket, recurring quantity, and discounts/adjustments.
- (2026-08-21) `BillingEngine.calculateBillingForPreparedPeriod` remains production's financial orchestrator: it selects lines/timing, resolves currency/context, dispatches calculation, combines results, and applies downstream rules.
- (2026-08-21) `ee/server/src/lib/billing/simulator/simulateContractScenario.ts` independently classifies services and dispatches each family across hypothetical periods.
- (2026-08-21) Simulator code rebuilds `IClientContractLine` and production-shaped activity records to invoke low-level compute functions instead of a shared domain input.
- (2026-08-21) Simulator `fixedChargeExplanationKey` and `timeChargeExplanationKey` replicate compute internals, demonstrating identity drift risk.
- (2026-08-21) Simulator discounts convert rendered lines back into synthetic fixed `IBillingCharge` records, creating a second financial assembly path.
- (2026-08-21) Simulator `pushChargeLine` and `finalizePeriod` independently construct financial lines and totals before view-model shaping.
- (2026-08-21) Current `IBillingResult` lacks version, mode, window, canonical key, explanations, diagnostics, and explicit persistence correlation.
- (2026-08-21) `IBillingCharge.billing_profile_id` is optional for simulation and required in production. The new boundary must preserve this without allowing unattributed live commit.
- (2026-08-21) Simulator uses read-only tax ports while production can provision defaults. Resolution/provisioning belongs in loaders/orchestration; resolved facts go to pure calculation.
- (2026-08-21) Production pins calculation in a transaction and has persisted recurring due-selection/idempotency behavior that remains around pure calculation.
- (2026-08-21) The worktree had a pre-existing `package-lock.json` modification; design work did not touch it.

## Commands / Runbooks

- (2026-08-21) Locate compute calls: `rg -n -C 4 "compute(Fixed|TimeBased|UsageBased|Bucket|RecurringQuantity|DiscountsAndAdjustments)" packages/billing/src/lib/billing/billingEngine.ts ee/server/src/lib/billing/simulator/simulateContractScenario.ts`.
- (2026-08-21) Inspect production: `sed -n '1030,2300p' packages/billing/src/lib/billing/billingEngine.ts`.
- (2026-08-21) Inspect simulator: `sed -n '1,1515p' ee/server/src/lib/billing/simulator/simulateContractScenario.ts`.
- (2026-08-21) Validate: `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-08-21-contract-simulator-billing-consolidation`.

## Links / References

- Prior design: `docs/plans/2026-07-30-billing-contract-simulator-plan.md`.
- Prior ledger: `ee/docs/plans/2026-07-30-billing-contract-simulator/`.
- Production facade: `packages/billing/src/lib/billing/billingEngine.ts`.
- Invoice orchestration: `packages/billing/src/actions/invoiceGeneration.ts`.
- Shared arithmetic: `packages/billing/src/lib/billing/compute/`.
- Simulator: `ee/server/src/lib/billing/simulator/simulateContractScenario.ts`.
- Simulator contracts: `packages/types/src/interfaces/contractSimulation.interfaces.ts`.
- Billing contracts: `packages/types/src/interfaces/billing.interfaces.ts` and `billingCompute.interfaces.ts`.

## Open Questions

## Draft implementation notes

- (2026-08-22) Takeover extraction routes fixed, hourly, usage, bucket, product/license, and discount/adjustment dispatch for both callers through `domain/calculateContractCharge.ts`; an architecture test rejects direct caller dispatch. Charge loaders remain in their existing caller modules for this first incremental slice.
- (2026-08-22) Production now guards live mode and consumes canonical net totals instead of discarding the document result. Simulation uses explicit simulate mode and has no persistence adapter. Billing typecheck/build and focused domain/simulator tests pass; EE typecheck passes with a 12 GB heap (8 GB exhausted during full-program analysis).

- (2026-08-21) Review correction: the first draft only assembled pre-priced lines. It does not meet the required shared dispatch/load/commit boundary; F004, F005, F014 and T001 remain open until canonical results carry all required financial metadata and the shared engine owns charge-family computation.

- (2026-08-21) Added `packages/billing/src/lib/billing/domain/` as the typed, pure canonical line/result boundary. It validates tenant/window/currency/minor-unit invariants and exposes explicit `simulate`/`live` modes.
- (2026-08-21) Simulator calls the shared assembler once per invoice window in `simulate` mode; production calls it after its existing transaction-scoped pricing/discount load in `live` mode. This is known insufficient and must be replaced by the planned shared calculation boundary.
- (2026-08-21) Focused validation: billing typecheck and pure domain tests passed; EE simulator period tests passed; EE typecheck needs `NODE_OPTIONS=--max-old-space-size=8192` in this environment.

- Is prepaid hour-block billing reachable from a contract scenario and required in the first obligation union?
- Does invoice-level tax redistribution after persistence intentionally differ from charge-level calculation in any supported tax configuration?
- Which reconciliation mutations must stay before calculation to preserve lock ordering, and which can follow a successful result?

## Takeover completion (2026-08-22)

- Round 3 correction adds an integration route into `generateInvoiceForNormalizedSelectionInputs`, the real production generation/persistence implementation behind the authenticated actions. The parity fixture materializes recurring service periods, runs the simulator before live generation, fingerprints externally visible tables across simulation, then compares canonical simulator detail with persisted `invoice_charges` semantics.

- Mitigation round 2 replaces the pre-priced document assembler with a required unpriced obligation union. Both normal production generation and every simulator period now collect resolved obligations and call `calculateContractBilling` once; family dispatch, discounts/adjustments, canonical lines, tax, and totals are owned there.
- Production family loaders retain their tenant-scoped reads and timing/idempotency checks but emit obligations into deterministic family-order sinks. Project/material/manual charges are an explicit non-contract supplemental-charge carve-out and still participate in document discounts and totals.
- The simulator no longer contains `calculateContractCharge`, `pushChargeLine`, or discount reconstruction. It maps canonical money into presentation-only labels and markers.
- The simulator integration suite now collects when the simulator imports the billing domain subpath. Its fixture was updated for current service-price upserts and line-owned bucket pools; the suite runs against the worktree DB on port 55432.

- Shared dispatch now carries charge-to-explanation associations directly and fails closed if a compute family returns unequal charge/explanation counts.
- Discounts and adjustments require the same explicit `simulate`/`live` mode as charge families.
- Representative dispatcher parity now covers hourly rounding/minimums, tiered usage, bucket overage/rollover state, product, license, tax, discounts, and adjustments.
- Production maps guarded canonical live totals through `applyCanonicalLiveBillingResult`; simulator integration fingerprints billing source/linkage, recurring periods, bucket state, invoices, numbering, audit, event, and outbox tables before and after simulation.
- The DB-backed simulator suite still cannot collect because `@alga-psa/reporting` does not export `actions/report-actions/getRemainingBucketUnits`; billing tests, simulator unit tests, and both package typechecks remain green.
