# Accounting export adjustment repair evidence

This is a partial mitigation record for the 2026-09-29 Draft Implementation pass on PR #3499. It is not final acceptance evidence.

## Implemented and checked

- The shared manual invoice charge persistence path rejects non-discount rows without a tenant-valid service. This covers standalone creation and draft add/update paths that call `persistManualInvoiceCharges`.
- Accounting batch validation now reports a description/invoice/line-specific service assignment instruction for legacy serviceless charges, and separately reports a missing discount mapping for discounts and credits.
- Finalize readiness now checks for the tenant/integration/realm-scoped QBO discount mapping and reports it as a blocker when auto-sync will run.
- QBO API emits fixed `DiscountLineDetail` rows; QBO CSV, Xero API and Xero CSV use the configured discount mapping and preserve the persisted negative amount.

## Automated verification

- `npx vitest run src/services/accountingSync/exportReadiness.test.ts ../packages/billing/tests/accounting/accountingExportValidation.rules.test.ts ../packages/billing/src/adapters/accounting/xeroAdapterFailClosed.db.test.ts` from `server/`: 28 tests passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing`: passed after fixing the Xero charge projection type.
- Focused ESLint over the touched TypeScript files: zero errors; 85 warnings were reported, primarily existing `any`, unused symbol, and environment-global warnings.
- `git diff --check`: passed.

## Acceptance still pending

The current mapping UI does not expose a discount mapping editor, and the external mapping write path does not yet allow the fixed `discount/invoice_discount` record. The QuickBooks Desktop IIF path has not been repaired. Miscellaneous service provisioning/default selection, legacy-charge edit behavior, editor early warnings, full serialized adapter tests, consolidated-parent export behavior, CSV/QBO/Xero artifacts, localization, full billing/accounting suites, full lint/build, and current-head UI smoke remain outstanding. The app server stayed stopped as required.

Do not use historical screenshots in the review guide as evidence for this repair. Full acceptance requires current-head configuration and end-to-end output evidence, including at least one real adapter-produced CSV and a mocked/emulated QBO or Xero payload, followed by the required UI re-smoke.
