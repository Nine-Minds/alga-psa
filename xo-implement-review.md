# Implement review — payment methods by billing profile

## Asked

Confirm profile-level payment-method selection, persistence and defaults; run focused checks; finalize necessary changes; recommend the next disposition. Reviewed product HEAD `8a99d0811d44c84c0b936dfffbbcc7c0a84e27da` on 2026-09-26. No Smoke Test or board transition was performed.

## Done

The requested profile UI, persistence and default behavior are implemented. No product-code finalization was needed.

- **Selection and reload:** `packages/clients/src/components/clients/ClientBillingProfileSettings.tsx:82` loads stored settings and client defaults; `:125` saves the draft; `:185` maps the inherit option to null; `:310` renders the payment-method selector. Shared Credit Card / Bank Transfer / Check options also feed the client form (`packages/clients/src/components/clients/BillingConfigForm.tsx:112`). The profile's saved-card display is read-only (`ClientBillingProfileSettings.tsx:324`).
- **Persistence and guards:** `packages/clients/src/actions/clientBillingProfileActions.ts:579` reads settings, `:630` updates under authentication/permission checks and a tenant-bound transaction, `:647` checks profile ownership, `:655` preserves omitted fields and clears explicit nulls, and `:674` rejects unsupported methods. `server/migrations/20260922120000_add_billing_profile_payment_method.cjs:45` adds the nullable profile column, database CHECK, and nullable invoice snapshot without backfill.
- **Defaults:** `shared/billingClients/billingProfileSettings.ts:92` resolves the default profile when none is supplied; `:167` resolves profile override before client value and records the override. `shared/billingClients/paymentPreferences.ts:61` normalizes unknown/blank legacy methods to null. Null means inherit, not an implicit credit-card default.
- **Invoice behavior:** recurring generation snapshots the effective method at `packages/billing/src/actions/invoiceGeneration.ts:3585`; manual generation does so at `packages/billing/src/actions/manualInvoiceActions.ts:201`. Effective profile terms drive due-date calculation through `packages/billing/src/lib/billing/invoiceDueDate.ts`. Offline snapshots suppress checkout in email context (`packages/billing/src/actions/invoiceEmailLinkContext.ts:39`), portal actions (`packages/client-portal/src/actions/clientPaymentActions.ts:156`), and portal UI (`packages/client-portal/src/components/billing/InvoicesTab.tsx:196`). Designer binding exists at `packages/billing/src/components/invoice-designer/fields/fieldCatalog.ts:56`.
- **Assigned smoke defect:** `packages/billing/src/actions/invoiceCalendarDate.ts:4` preserves calendar dates for date-only values and UTC/local-midnight Date representations. Both recipient and send-email paths use it (`packages/billing/src/actions/invoiceJobActions.ts:285`, `:520`).

## Verified

Fresh automated checks against the reviewed HEAD (logs: `/tmp/payment-profile-implement-review/`):

- **48/48 tests, 8 files passed** using server Vitest with coverage disabled: `shared/billingClients/__tests__/paymentPreferences.test.ts`; billing `invoiceCalendarDate.test.ts`, `invoiceEmailLinkContext.offlinePayment.test.ts`, `invoiceDueDate.test.ts`, `invoiceAdapters.test.ts`; portal `clientPaymentActions.offlinePayment.test.ts`, `InvoicesTab.paymentMethods.test.tsx`; server pay-page `page.paymentMethod.test.tsx`. Paths are relative to their source package; full selected paths appear in `unit.log`.
- **12/12 database integration tests, 2 files passed:** from `server`, `npx vitest run src/test/integration/billing/billingProfilePaymentMethod.integration.test.ts src/test/integration/billing/billingProfileAttribution.integration.test.ts --coverage.enabled=false`. These target dedicated `test_db_billing_profile_payment_method` and `test_db_billing_profile_recurring_acceptance` databases. They verify inheritance, clearing, database rejection, saved-card isolation, profile terms, real recurring generation and immutable snapshots, plus the real invoice model/date boundary across three time zones.
- Calendar-date tests exercise recipient output and direct-send content delivered to an isolated test SMTP emulator in UTC, America/New_York and Asia/Tokyo. This is automated action-level evidence, not live application/worker delivery acceptance.
- **Package typechecks passed (exit 0):** `npm run typecheck` in `packages/clients`, `packages/billing`, and `packages/client-portal`.
- **Broader server typecheck still running at handoff:** from `server`, `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck`; log `server-typecheck.log`, execution session `82762`. No diagnostics at packet creation. Confirm its exit before treating this additional check as passed.
- `git diff --check origin/main...HEAD` passed.

## Unsure

- The prior live report remains **FAIL / partial acceptance** (`/tmp/alga-smoke-evidence/payment-methods-by-billing-profile-20260926T1809Z/REPORT.md`). Its date defect now has passing regressions, but this desk review does not replace the subsequent live retest. Saved-card rendering, recurring sibling flows, authenticated portal/payment-provider behavior and configured live email delivery remain live acceptance work.
- The plan explicitly records no automated profile-settings component test (T006), and T002 only automates database validation, not the settings action's invalid-input response. UI save/reload/inherit had prior live evidence; action guards were inspected here.
- Known draft limits remain: REST InvoiceService, hour-block and sales-order invoice creation do not snapshot the method (plan scratchpad); invoice-rendered method labels are authored English (`shared/billingClients/paymentPreferences.ts:34`, `packages/billing/src/lib/adapters/invoiceAdapters.ts:648`), despite F015's stronger “localized” wording. This is not a claim that every invoice entry point or every plan item is complete.

## Recommendation

**Advance to the next verification step**, after confirming the pending broader server typecheck passes. The commissioned UI/persistence/default behavior is complete and focused regressions pass. Carry the above limits into the XO review and live acceptance; do not interpret this recommendation as final release approval or a passed Smoke Test. Routing remains with the XO.
