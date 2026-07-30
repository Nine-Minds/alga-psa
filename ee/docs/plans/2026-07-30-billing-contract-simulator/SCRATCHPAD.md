# Scratchpad — Billing Contract Simulator

- Plan slug: `billing-contract-simulator`
- Created: `2026-07-30`

## Decisions

- (2026-07-30) The completed design document remains the design source; this folder tracks implementation and verification rather than reopening product scope.
- (2026-07-30) Production billing behavior is the fidelity reference when implementation discoveries require judgment.
- (2026-07-30) Finish schedule/context fidelity and equivalence gates before expanding the prototype UI.
- (2026-07-30) Treat unsupported billing-relevant families as incomplete, not as an acceptable diagnostic-only final state.
- (2026-07-30) Resolve database context before deterministic arithmetic; asynchronous tax ports inside compute are an interim seam, not the final pure-compute contract.
- (2026-07-30) Invoice horizons begin with the production billing window containing the requested as-of date, aligned through the client's normalized anchors; they do not create rolling windows from the arbitrary as-of day.

## Discoveries / Constraints

- (2026-07-30) Branch started with fixed and hourly compute extraction only; usage, bucket, products/licenses, and discounts remain in `BillingEngine`.
- (2026-07-30) `ContractScenario` lacks client billing-cycle anchor settings and service item-kind/license identity.
- (2026-07-30) `buildInvoicePeriods` currently starts windows directly at `horizon.start_date` using contract frequency, which can diverge from production client billing windows.
- (2026-07-30) Scenario UI currently edits rates only; compare mode reports total deltas rather than structured line diffs.
- (2026-07-30) The simulator currently uses a custom invoice table instead of the production preview view model/renderer.
- (2026-07-30) `packages/billing/src/lib/billing/compute/compute.test.ts` contains 10 tests but is excluded by `packages/billing/vitest.config.ts` include globs.
- (2026-07-30) Added the compute-test include glob; all 10 fixed/hourly compute tests now execute and pass.
- (2026-07-30) Scenario snapshots now retain effective invoice schedule anchors, line location/overtime fields, system-default provenance, and catalog product/license identity.
- (2026-07-30) Existing untracked `.smoke-tmp/` predates this implementation pass and must remain untouched.

## Commands / Runbooks

- (2026-07-30) Billing typecheck: `cd packages/billing && npm run typecheck`.
- (2026-07-30) EE typecheck: `cd ee/server && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`.
- (2026-07-30) Cadence tests: `cd ee/server && npx vitest run --config vitest.config.ts src/__tests__/unit/contractSimulator.hypotheticalPeriods.test.ts`.
- (2026-07-30) Compute tests: `cd packages/billing && npx vitest run --config vitest.config.ts src/lib/billing/compute/compute.test.ts`.
- (2026-07-30) Validate this ledger: `python3 /home/robert/nm-skills/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-07-30-billing-contract-simulator`.

## Links / References

- Completed design: `docs/plans/2026-07-30-billing-contract-simulator-plan.md`.
- Mockups: `docs/plans/2026-07-30-billing-contract-simulator-mockups/`.
- Shared compute: `packages/billing/src/lib/billing/compute/`.
- EE simulator: `ee/server/src/lib/billing/simulator/`.

## Open Questions

- None currently blocking. Record new questions only when evidence cannot resolve them safely.
