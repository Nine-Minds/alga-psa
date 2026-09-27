# Contract invoice adjustments repair evidence (2026-09-27)

## Completed in this repair pass

- Corrected migration ordering so the legacy unique constraint is removed before expanding assignments; the original assignment UUID is retained for the first client assignment, and added assignments get new settlement identities. Added populated-schema migration coverage for one and multiple client contracts and reruns, plus shared-definition split and rerun coverage.
- Added migration handling that creates independent discount rows where old client assignments share a definition. Removed shared-definition attachment controls/messages from the client-contract Discounts tab and removed the shared-attach server actions; assigned definitions now verify single-client ownership before edits/toggles. Mounted template default discount authoring for contract, line, and service scope; the client contract wizard copies independent discount rows through `templateClone.ts` and remaps line scope from template services. Contract assignment policies preserve service scope while contract scope applies to all attributed charges of that client contract.
- Standardized calculator metadata with direction nested under `partialPeriod`; the action-level DB test invokes `updateInvoiceManualItems` with UI-shaped increase/decrease rows, then reloads and edits. Server validation derives source service periods from `invoice_charge_details`, normalizes inclusive detail ends to half-open dates, checks the source rate and quantity, persists a rounded per-unit rate and product amount, and rejects unresolved source tax rates. The displayed equation shows the same per-unit rounding rule used for settlement. A transaction-time overlap check now rejects a newly arrived true-up until the save flow explicitly confirms its ID. The permanent-change link passes the selected `contractLineId`; the contract Lines tab expands, scrolls to, and highlights that line.
- Added the companion interface and non-reproration/retry expectations to the plan and [companion handoff](../f6e7254b-contract-product-schedule/companion-handoff.md).

## Verification

- `npm exec -- vitest run migrations/__tests__/contractDiscountAssignmentsClientScopeMigration.integration.test.ts` from `server/` — passed, 2 migration integration tests. They reconstruct populated old-schema tables, verify one and two assignment fanout, preserve original settlement identity, split previously shared definitions, and rerun safely.
- `set -a; source .env.localtest; set +a; node scripts/run-workspace-db-tests.mjs packages/billing/src/services/contractInvoiceAdjustments.db.test.ts` — passed, 34 DB-backed tests. This test lane uses Postgres `127.0.0.1:5472` and its dedicated `test_database`; the server was not started.
- `npm run test --workspace=@alga-psa/billing -- src/lib/billing/compute/contractInvoiceAdjustments.test.ts` — passed, 28 tests, including cross-line contract-wide eligibility and explicit line/service scope.
- Focused ESLint across changed billing/types files — exit 0, 0 errors, 187 warnings; the final discount action isolation change linted with 0 warnings.
- `npm run build --workspace=@alga-psa/billing` — passed.
- `node scripts/generate-pseudo-locales.cjs` — generated 102 pseudo-locale files; `node scripts/validate-translations.cjs` — passed, 9 locales checked, no errors or warnings.
- `git diff --check` — passed.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck --workspace=@alga-psa/billing` — run on both this revision and parent `ae498b94c4`; both fail with the same errors in `src/actions/profitabilityReportActions.ts` and `packages/ui/src/editor/*`, and neither reports diagnostics in modified files. This substantiates those package errors as parent-revision failures.

## Outstanding implementation and acceptance

- Template authoring, copy, and independent-definition DB tests are implemented. Still not proven end-to-end: two separate invoice settlements for two client contracts from one template, or contract-wide settlement isolation on a consolidated invoice.
- Fabricated companion `contract_change` rows are covered through repeated DB reconciliation: their supplied half-open amount and source row remain unchanged and their amount enters the shared discount base. The companion generator/scheduler was not modified or live-integrated; verify the supplied contract against PR #3492 during acceptance.
- The exact `$3,900 + $150` discount example, two-contract exactly-once invoice settlements, fixed-credit/tax/currency/stacking matrix, billed/locked history after cancellation, and end-to-end overlap guard remain to be verified. Parent comparison of billing typecheck failures has been completed.
- **Live acceptance outstanding by instruction:** keep the app server stopped. Current-revision live smoke and `SMOKE-ADJ-1` reseeding must occur in the authorized smoke step, not be inferred from automated tests or historical screenshots.

## Reviewer walkthrough order

1. Template authoring → independent client-contract discount copies → one correct invoice settlement per contract (this must be implemented before acceptance).
2. Calculator source selection → derived dates/equation → save/reload/edit, then newly arriving overlap confirmation and selected-line permanent-change navigation.
3. Invoice editing, tax/PDF/portal/export, lifecycle blocks, and billed/locked date/text history protections.
