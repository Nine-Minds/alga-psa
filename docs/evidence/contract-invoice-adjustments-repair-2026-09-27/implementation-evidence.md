# Contract invoice adjustments repair evidence (2026-09-27)

## Completed in this repair pass

- Corrected migration ordering so the legacy unique constraint is removed before expanding assignments; the original assignment UUID is retained for the first client assignment, and added assignments get new settlement identities. Added populated-schema migration coverage for one and multiple client contracts and reruns.
- Added migration handling that creates independent discount rows where old client assignments share a definition. Removed shared-definition attachment controls and messages from the client-contract Discounts tab. Contract assignment policies preserve service scope while contract scope applies to all attributed charges of that client contract.
- Standardized calculator metadata with direction nested under `partialPeriod`; the action-level DB test invokes `updateInvoiceManualItems` with UI-shaped increase/decrease rows, then reloads and edits. Server validation derives source service periods from `invoice_charge_details`, normalizes inclusive detail ends to half-open dates, checks the source rate and quantity, persists a rounded per-unit rate and product amount, and rejects unresolved source tax rates. The displayed equation shows the same per-unit rounding rule used for settlement.
- Added the companion interface and non-reproration/retry expectations to the plan and [companion handoff](../f6e7254b-contract-product-schedule/companion-handoff.md).

## Verification

- `npm exec -- vitest run migrations/__tests__/contractDiscountAssignmentsClientScopeMigration.integration.test.ts` from `server/` — passed, 1 migration integration test. It reconstructs populated old-schema tables, verifies one and two assignment fanout, preserves original settlement identity, and reruns safely.
- `set -a; source .env.localtest; set +a; node scripts/run-workspace-db-tests.mjs packages/billing/src/services/contractInvoiceAdjustments.db.test.ts` — passed, 32 DB-backed tests. This test lane uses Postgres `127.0.0.1:5472` and its dedicated `test_database`; the server was not started.
- `npm run test --workspace=@alga-psa/billing -- src/lib/billing/compute/contractInvoiceAdjustments.test.ts` — passed, 27 tests.
- Focused ESLint across touched billing/types files — exit 0, 0 errors, 107 warnings.
- `git diff --check` — passed at last check.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck --workspace=@alga-psa/billing` — completed with type errors in `src/actions/profitabilityReportActions.ts` and `packages/ui/src/editor/*`; no diagnostics reported in the modified files. These are not yet substantiated against the parent revision, so they are not classified as pre-existing for acceptance.

## Outstanding implementation and acceptance

- **Not complete:** template default-discount authoring is not yet mounted, and the template-to-independent-client-contract copy through `templateClone.ts` is not implemented. The required two-contract template isolation and exactly-one-settlement flow is therefore not proven.
- **Not complete:** overlap detection is presently only the client-side pre-save check against currently loaded invoice rows. It does not recheck under the save transaction or confirm a newly arriving overlap. The permanent-change link opens the Lines tab, but does not select/highlight the intended line.
- Companion `contract_change` source reconciliation is not yet covered end-to-end by fabricated DB rows or repeated regeneration tests. The new handoff records the supplied interface; the companion implementation itself was not modified.
- The exact `$3,900 + $150` discount example, two-contract isolation, fixed-credit/tax/currency/stacking matrix, billed/locked history after cancellation, and required parent-revision typecheck comparison remain to be verified.
- **Live acceptance outstanding by instruction:** keep the app server stopped. Current-revision live smoke and `SMOKE-ADJ-1` reseeding must occur in the authorized smoke step, not be inferred from automated tests or historical screenshots.

## Reviewer walkthrough order

1. Template authoring → independent client-contract discount copies → one correct invoice settlement per contract (this must be implemented before acceptance).
2. Calculator source selection → derived dates/equation → save/reload/edit, then newly arriving overlap confirmation and selected-line permanent-change navigation.
3. Invoice editing, tax/PDF/portal/export, lifecycle blocks, and billed/locked date/text history protections.
