# Contract invoice adjustments repair evidence (2026-09-27)

## Implemented and verified in this worktree

- Contract discount assignments now identify the client-contract assignment, so settlement attribution can distinguish two contracts for one client and avoid applying a contract-wide discount to another contract's charges on a consolidated invoice.
- Manual partial-period calculator changes derive source terms, validate their persistence against the invoice's detail-row period, use `adjustment_period_start/end`, preserve the true unit delta, and record resolved cents in metadata. The display includes the date-derived calculation and permanent-change link.
- The calculator confirms before adding a manual adjustment when a source-linked companion `contract_change` row overlaps the selected line and half-open period. The boundary helper has a fabricated-row unit test.
- Fixed positive recurring charges remain catalog-backed contract lines; fixed recurring credits use the existing discount pipeline.

## Commands and results

- `npm run test --workspace=@alga-psa/billing -- src/lib/billing/compute/contractInvoiceAdjustments.test.ts` — passed, 26 tests.
- `set -a; source .env.localtest; set +a; node scripts/run-workspace-db-tests.mjs contractInvoiceAdjustments.db.test.ts` — passed, 31 DB-backed tests. The DB endpoint was verified as Postgres `127.0.0.1:5472`; the suite recreated only `test_database`.
- `node scripts/generate-pseudo-locales.cjs` — generated 102 pseudo-locale files.
- `node scripts/validate-translations.cjs` — passed, 9 locales checked, no errors or warnings.
- Focused ESLint over changed billing files — exit 0, warnings only.
- Billing package typecheck — failed with 11 errors in untouched `profitabilityReportActions.ts` and `packages/ui/src/editor/*`; no diagnostics referenced the modified billing files.
- `git diff --check` — passed.

## Still required before acceptance

- Add template default-discount authoring to the mounted `ContractTemplateDetail` surface and copy independent definitions into each client contract through the template clone workflow. This is not implemented in this worktree yet.
- Integrate the companion `contract_change` settlement/reconciliation interface. The requested companion handoff file was absent from this checkout; this work adds the manual overlap confirmation only and does not add or change the companion writer.
- Add DB-backed tests for independent template copies, their isolation, the full fixed/fractional/tax/currency matrix, companion settlement idempotency, and billed/locked history after cancellation.
- Run the live acceptance walkthrough only when allowed and an endpoint serving this revision is available. Do not interpret the DB suite or historical evidence as live verification.

## Live walkthrough outline

1. Author default discount terms on a template; create two client contracts from that template and confirm each Discounts tab owns an editable independent copy.
2. Refresh each eligible draft invoice and verify exactly one source-linked settlement per contract, contract-wide bases across represented lines, consolidated-invoice isolation, and the $3,900 + $150 example ($405 discount, $3,645 before tax).
3. Edit the template and one client contract; refresh both invoices and verify the other existing copy remains unchanged.
4. On an editable draft, use Add Charge, Add Discount and manual edit/remove, then reopen/reload and compare preview, PDF, portal and export amounts.
5. Re-seed `SMOKE-ADJ-1` through the source-derived calculator; check service, quantity, dates, reason, tax and reload. Follow the permanent-change link and verify the selected contract line. Test an overlapping companion row and both half-open date boundaries.
6. Verify billed, locked, cancelled, finalized and exported lifecycle blocks, including billed/locked line text/date protections after cancellation.
