# PRD — Billing Contract Simulator

- Slug: `billing-contract-simulator`
- Date: `2026-07-30`
- Status: Approved design; implementation in progress
- Design source: [`docs/plans/2026-07-30-billing-contract-simulator-plan.md`](../../../../docs/plans/2026-07-30-billing-contract-simulator-plan.md)

## Summary

Deliver an Enterprise contract simulator that prices an editable, unsaved contract scenario over multiple future or historical billing periods without changing billing data. Production invoice generation and simulation must share the same charge computation so the simulator is trustworthy.

This PRD is the execution ledger for the completed design source above. Where implementation evidence reveals a fidelity problem, prefer the behavior of production billing and record the decision in `SCRATCHPAD.md`.

## Problem

Contract configuration errors are currently discovered only after live billing creates an invoice. By then, real activity and persisted billing state make correction expensive and risky. A preview that merely approximates production billing would preserve the same trust problem.

## Goals

- Simulate fixed, hourly, usage, bucket, product, license, discount, adjustment, proration, cadence, and tax behavior through shared production computation.
- Support in-memory what-if edits without writing contract or billing state.
- Show a multi-period invoice timeline with line-level explanations and comparisons.
- Support future assumptions, recent-average prefill, and historical replay.
- Expose the same simulator from contract detail, contract creation, and templates in EE; show a clear upgrade state in CE.

## Non-goals

- Persisting named scenarios in v1.
- Applying a scenario back to a live contract in v1.
- Issuing invoices, allocating invoice numbers, emitting billing events, or mutating billing records from simulation.
- Exact per-entry historical replay where aggregation intentionally loses technician-level nuance.

## Users and Primary Flows

1. A billing administrator opens a live contract, changes scenario settings and activity assumptions, and simulates the next 3–12 invoice periods.
2. The administrator expands a period, inspects invoice lines, and opens a structured explanation of each amount.
3. The administrator compares the edited scenario with the untouched live snapshot.
4. The administrator loads recent averages or a historical window into the assumption grid and compares simulated output with issued invoices.
5. A contract author simulates wizard draft state before saving.
6. A template author simulates a contract template against a real or hypothetical client profile.

## UX / UI Notes

- Follow the committed workbench and ledger-grid mockups in `docs/plans/2026-07-30-billing-contract-simulator-mockups/` using product components.
- Keep edits local until an explicit Simulate action.
- Make unsupported or unpriceable behavior visible and never silently omit money.
- Render simulated invoices using the same preview shaping and renderer used by production previews.

## Requirements

### Functional Requirements

- Snapshot every billing-relevant contract, assignment, client-schedule, location, catalog, pricing, tax, and service configuration field into a serializable scenario.
- Generate invoice and service-period windows from the same cadence rules and anchors used by production.
- Expand assumptions into synthetic activity and thread bucket state across periods.
- Run every supported charge family through shared production computation.
- Produce stable simulated invoice view models, structured explanations, diagnostics, and pure line-level comparisons.
- Provide complete scenario editing, assumption prefill, replay, contract-detail, wizard, and template entry points.

### Non-functional Requirements

- Simulation performs no inserts, updates, deletes, invoice-number allocation, analytics emission, or event publication.
- Shared compute is deterministic for fully loaded inputs; data resolution belongs outside arithmetic.
- Existing production billing output remains equivalent across the refactor.
- Monetary values remain integer minor units and date ranges preserve established half-open semantics.

## Data / API / Integrations

- Shared compute lives under `packages/billing/src/lib/billing/compute/`.
- Shared scenario/result types live in `packages/types`.
- EE orchestration lives under `ee/server/src/lib/billing/simulator/`.
- Edition-gated server actions live in `packages/billing/src/actions/contractSimulationActions.ts`.
- No schema addition is required for v1 in-memory scenarios.

## Security / Permissions

- Require billing read permission for snapshot, simulation, averages, and replay actions.
- Enforce tenant scoping on every database read.
- Never trust scenario-provided tenant or client identifiers without validating them against authenticated scope.
- CE builds must not load or execute EE implementation modules.

## Rollout / Migration

- Land compute-family extraction incrementally with equivalence tests.
- Keep the simulator explicitly diagnostic until all charge families and fidelity gates pass.
- A feature flag may be added for rollout, but edition gating is mandatory.

## Open Questions

- None currently blocking. Implementation discoveries are resolved using production billing behavior as the fidelity reference and recorded in `SCRATCHPAD.md`.

## Acceptance Criteria (Definition of Done)

- Every item in `features.json` and `tests.json` is implemented and verified.
- Representative production charge outputs are byte-equivalent before and after extraction.
- DB-backed tests prove simulation is read-only and tenant-safe.
- Fixed, hourly, usage, bucket, product, license, discounts, adjustments, tax, proration, and mixed cadences are simulated.
- Contract detail, wizard, and template EE flows pass Playwright smoke tests; CE renders the upgrade state.
- No unsupported billing-relevant configuration is silently excluded from totals.
