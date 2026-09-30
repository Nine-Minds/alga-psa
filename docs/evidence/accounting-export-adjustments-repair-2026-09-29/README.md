# Accounting export adjustment repair evidence

This is a partial mitigation record for the 2026-09-29 Draft Implementation pass on PR #3499. It is not final acceptance evidence.

## Implemented and checked

- The shared manual invoice charge persistence path rejects non-discount rows without a tenant-valid service. The draft update path also validates explicitly supplied update services, including legacy serviceless rows. This is not yet backed by behavioral coverage for standalone creation and draft add/update endpoints.
- Accounting batch validation now reports a description/invoice/line-specific service assignment instruction for legacy serviceless charges, and separately reports a missing discount mapping for discounts and credits.
- Finalize readiness now checks for the tenant/integration/realm-scoped QBO discount mapping and reports it as a blocker when auto-sync will run.
- QBO API emits fixed `DiscountLineDetail` rows; QBO CSV, Xero API and Xero CSV use the discount resolver and preserve the persisted negative amount. Discount mapping cannot yet be written/configured through settings, and serialized behavior remains incompletely tested.
- CSV discount exports now use a single signed line to avoid rate rounding changing the settled amount. Xero API discount quantity/rate are derived from the settled amount (credit quantity is kept when the minor-unit rate is exact).

## Automated verification

- `npx vitest run src/services/accountingSync/exportReadiness.test.ts` from `server/`: 10 tests passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing`: passed after fixing the Xero charge projection type.
- Focused ESLint over the touched TypeScript files: zero errors; 85 warnings were reported, primarily existing `any`, unused symbol, and environment-global warnings.
- `git diff --check`: passed before the latest changes.

## Acceptance still pending

The current mapping UI does not expose a discount mapping editor, and the external mapping write path does not yet allow the fixed `discount/invoice_discount` record. The QuickBooks Desktop IIF path has not been repaired. Miscellaneous service provisioning/default selection, editor early warnings, full serialized adapter tests, consolidated-parent export behavior, CSV/QBO/Xero artifacts, localization, full billing/accounting suites, full lint/build, and current-head UI smoke remain outstanding. The new focused DB run found 12 failures in the broader existing adjustment suite because test/manual-add fixtures lack the newly required service; the test suite is not green. The app server stayed stopped as required.

Do not use historical screenshots in the review guide as evidence for this repair. Full acceptance requires current-head configuration and end-to-end output evidence, including at least one real adapter-produced CSV and a mocked/emulated QBO or Xero payload, followed by the required UI re-smoke.
