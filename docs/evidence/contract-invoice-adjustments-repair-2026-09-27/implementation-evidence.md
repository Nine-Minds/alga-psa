# Contract invoice adjustments repair evidence (2026-09-27)

## Completed in this repair pass

- Corrected migration ordering so the legacy unique constraint is removed before expanding assignments; the original assignment UUID is retained for the first client assignment, and added assignments get new settlement identities. Added populated-schema migration coverage for one and multiple client contracts and reruns, plus shared-definition split and rerun coverage.
- Added migration handling that creates independent discount rows where old client assignments share a definition. Removed shared-definition attachment controls/messages from the client-contract Discounts tab and removed the shared-attach server actions; assigned definitions now verify single-client ownership before edits/toggles. Mounted template default discount authoring for contract, line, and service scope; the client contract wizard copies independent discount rows through `templateClone.ts` and remaps line scope from template services. Contract assignment policies preserve service scope while contract scope applies to all attributed charges of that client contract.
- Standardized calculator metadata with direction nested under `partialPeriod`; the action-level DB test invokes `updateInvoiceManualItems` with UI-shaped increase/decrease rows, then reloads and edits. Server validation derives source service periods from `invoice_charge_details`, normalizes inclusive detail ends to half-open dates, checks the source rate and quantity, persists a rounded per-unit rate and product amount, and rejects unresolved source tax rates. The displayed equation shows the same per-unit rounding rule used for settlement. A transaction-time overlap check now rejects a newly arrived true-up until the save flow explicitly confirms its ID. The permanent-change link passes the selected `contractLineId`; the contract Lines tab expands, scrolls to, and highlights that line.
- Added the companion interface and non-reproration/retry expectations to the plan and [companion handoff](../f6e7254b-contract-product-schedule/companion-handoff.md).

## Verification

- `npm exec -- vitest run migrations/__tests__/contractDiscountAssignmentsClientScopeMigration.integration.test.ts` from `server/` — passed, 3 migration integration tests. They reconstruct populated old-schema tables, verify one and two assignment fanout, preserve original settlement identity, split previously shared definitions, and rerun safely.
- `set -a; source .env.localtest; set +a; node scripts/run-workspace-db-tests.mjs packages/billing/src/services/contractInvoiceAdjustments.db.test.ts` — passed, 38 DB-backed tests. This test lane uses Postgres `127.0.0.1:5472` and its dedicated `test_database`; the server was not started.
- `npm run test --workspace=@alga-psa/billing -- src/lib/billing/compute/contractInvoiceAdjustments.test.ts` — passed, 28 tests, including cross-line contract-wide eligibility and explicit line/service scope.
- Focused ESLint across changed billing/types files — exit 0, 0 errors (191 warnings across the changed files).
- `npm run build --workspace=@alga-psa/billing` — passed.
- `node scripts/generate-pseudo-locales.cjs` — generated 102 pseudo-locale files; `node scripts/validate-translations.cjs` — passed, 9 locales checked, no errors or warnings.
- `git diff --check` — passed.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck --workspace=@alga-psa/billing` — run on this revision and parent `8a5b3ba950`; both fail with the same unrelated errors in `src/actions/profitabilityReportActions.ts` and `packages/ui/src/editor/*`, and neither reports diagnostics in modified files. This substantiates those package errors as parent-revision failures.

## Outstanding implementation and acceptance

- Template authoring and two independent client-contract copies are covered by action/DB tests. Both copies settle 10% exactly once across multiple billed rows and survive repeat reconciliation; the separate calculator acceptance settles the $3,900 + $150 example to one $405 discount. The same-client other-contract test checks assignment isolation.
- Fabricated companion `contract_change` rows are covered through repeated DB reconciliation: their supplied half-open amount and source row remain unchanged and their amount enters the shared discount base. The companion generator/scheduler was not modified or live-integrated; verify the supplied contract against PR #3492 during acceptance.
- Automated coverage includes the `$3,900 + $150` example, independent two-contract exactly-once settlements, fixed credits/discounts, currency precision, stacking, tax and lifecycle/history regressions, and source-linked overlap confirmation. Current-revision live smoke is the remaining acceptance gate. Parent comparison of billing typecheck failures has been completed.
- **Live acceptance outstanding by instruction:** keep the app server stopped. Current-revision live smoke and `SMOKE-ADJ-1` reseeding must occur in the authorized smoke step, not be inferred from automated tests or historical screenshots.

## Reviewer walkthrough order

1. Template authoring → independent client-contract discount copies → one correct invoice settlement per contract (this must be implemented before acceptance).
2. Calculator source selection → derived dates/equation → save/reload/edit, then newly arriving overlap confirmation and selected-line permanent-change navigation.
3. Invoice editing, tax/PDF/portal/export, lifecycle blocks, and billed/locked date/text history protections.
# Round 3 follow-up

This round repairs decimal quantity validation, signed cent rounding, copy
idempotence, client-contract ownership for line terms, and half-open start-date
eligibility. Template saves now validate date/value/scope basics server-side;
failed saves retain panel inputs. New DB/action regression coverage exercises
decimal quantities and both adjustment directions through
`updateInvoiceManualItems`.

The follow-up migrations are
`server/migrations/20260927050000_track_contract_template_discount_copies.cjs`
and `server/migrations/20260927060000_scope_line_discounts_to_client_contracts.cjs`.
The first records each template term's copied definition under a unique
client-contract identity; the second fans legacy line terms out to independent
client-contract-owned definitions.

The companion branch is present as a remote ref, but its checkout does not
contain the `contractInvoiceAdjustments.ts` writer or other implementation files;
only the supplied `docs/evidence/f6e7254b-contract-product-schedule/companion-handoff.md`
is available. Period, provenance, and overlap assumptions follow that supplied
interface. Live smoke and `SMOKE-ADJ-1` reseeding remain outstanding because the
app server is intentionally stopped.

## Round 3 verification (final)

- `TEST_DB_NAME=test_adj_r3_round3h NODE_OPTIONS=--max-old-space-size=6144 vitest run --config vitest.workspace-db.config.ts ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts` from `server/` — passed, 38 DB-backed tests (final rerun `test_adj_r3_round3i`). This includes decimal quantities 1.1/2.3/0.29, signed half-cent increases/decreases through the action, the calculator-derived $150 plus $3,900 recurring line settling to one $405 discount, and two independent template copies each settling exactly once across two billed charge rows followed by repeat reconciliation.
- `TEST_DB_NAME=test_adj_r3_mig_round3 npm exec -- vitest run migrations/__tests__/contractDiscountAssignmentsClientScopeMigration.integration.test.ts` from `server/` — passed, 3 migration integration tests covering old-schema attachment fanout, retained identities, shared definition splitting, and reruns.
- `npm run test -- src/lib/billing/compute/contractInvoiceAdjustments.test.ts` from `packages/billing/` — passed, 28 evaluator tests.
- Billing package `tsup` build — passed. Focused ESLint — exit 0, 0 errors (191 warnings). Migration JavaScript syntax checks and `git diff --check` — passed.
- Billing `tsc --noEmit` — remains blocked by 11 pre-existing package diagnostics in `profitabilityReportActions.ts` and `packages/ui/src/editor/*`. The parent revision comparison was run at `8a5b3ba950`; its diagnostics are in those same unrelated files, and the repaired files have no remaining diagnostics.

The dedicated acceptance DB coverage now checks independent copies, multi-charge contract-wide eligibility, one settlement per client contract, and repeat refresh; the calculator acceptance separately proves the $3,900 + $150 base. The generated settlement source identity is the assignment UUID while each contract owns a distinct copied discount definition.

**Still outstanding:** authorized live smoke on the current revision and reseeding `SMOKE-ADJ-1` through the calculator. The application server remained stopped throughout implementation and verification. The companion writer was not available on its branch checkout; integration assumes the durable supplied handoff and requires smoke confirmation.
