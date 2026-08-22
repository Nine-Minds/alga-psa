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

- (2026-08-21) Added `packages/billing/src/lib/billing/domain/` as the typed, pure canonical line/result boundary. It validates tenant/window/currency/minor-unit invariants and exposes explicit `simulate`/`live` modes.
- (2026-08-21) Simulator calls the shared engine once per invoice window in `simulate` mode; production calls it after its existing transaction-scoped pricing/discount load in `live` mode and fails fast if canonical totals differ.
- (2026-08-21) Focused validation: billing typecheck and pure domain tests passed; EE simulator period tests passed; EE typecheck needs `NODE_OPTIONS=--max-old-space-size=8192` in this environment.

- Is prepaid hour-block billing reachable from a contract scenario and required in the first obligation union?
- Does invoice-level tax redistribution after persistence intentionally differ from charge-level calculation in any supported tax configuration?
- Which reconciliation mutations must stay before calculation to preserve lock ordering, and which can follow a successful result?
