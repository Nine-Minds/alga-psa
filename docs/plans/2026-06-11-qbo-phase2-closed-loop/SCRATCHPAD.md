# SCRATCHPAD — QBO Phase 2: Closed-Loop Accounting Sync

## Decisions (with rationale)

- **2026-06-10 — QBO is authoritative for payments; Alga pushes both ways**
  (user-confirmed). Bookkeepers live in QBO; payments recorded there flow into
  Alga as real AR records, and Alga-originated (Stripe portal) payments push
  out so the books agree. Conflicts resolve in QBO's favor.
- **2026-06-10 — CDC polling through the `IJobRunner` abstraction, no Intuit
  webhooks this phase** (user-confirmed, with correction: "pg-boss is usually
  not used, usually temporal is, but the abstraction should handle it
  properly"). On-prem appliances cannot receive Intuit webhooks, so polling
  must exist regardless; one code path for hosted + appliance.
- **2026-06-10 — Credit semantics reshape lands before credit sync**
  (user-confirmed after impedance-mismatch review). `applyCreditToInvoice`
  decrements `invoices.total_amount` (`creditActions.ts:910`) — posted
  documents must be immutable; application moves derived balance-due. Reshape
  now while the credit system is barely used; backfill is recoverable
  (`total_amount += credit_applied`).
- **2026-06-10 — Real void semantics** (user-confirmed). `cancelled` status and
  `invoice_cancelled` transaction type exist in the schema but are unused; a
  `voidInvoice` action adopts them. Hard delete blocked for exported invoices.
- **2026-06-10 — Architecture B: central sync engine** (user-confirmed) over
  per-feature jobs (fragmented state) and over resurrecting the event-bus push
  model deliberately removed in Oct 2025
  (migration `20251031121500_remove_qbo_workflow_automation.cjs`).
- **2026-06-11 — Engine is adapter-agnostic by construction.** Shared tables
  carry `adapter_type`; no `qbo_` prefixes. Xero adopts the engine in a later
  phase ~for free.
- **2026-06-11 — Test planning follows the 80/20 rule** (user-directed):
  automated tests target ~80% confidence; the rest is the live Intuit-sandbox
  smoke checklist. `tests.json` marks live-smoke entries with
  `"mode": "live-smoke"`.

## Key file paths

- Design (scope authority for architecture): `./design.md`
- Phase 1 feature commit: `01ff24f662`; design commit: `91fc97b5b6`
  (branch `release/qbo-online-integration`)
- Adapter: `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`
- Client service: `packages/integrations/src/lib/qbo/qboClientService.ts`
- Payment landing (to refactor into shared service):
  `ee/server/src/lib/payments/PaymentService.ts:598` (`recordPaymentFromWebhook`)
- Credit application mutation site: `packages/billing/src/actions/creditActions.ts:910`
- Job abstraction: `packages/jobs/src/lib/jobs/interfaces/IJobRunner.ts`;
  startup registration `server/src/lib/jobs/initializeScheduledJobs.ts`
- Workflow task inbox: `shared/workflow/persistence/workflowTaskModel.ts:119`;
  unwired `qbo_mapping_error` task type from migration
  `20250511215231_consolidate_qbo_workflow_schema.cjs:126`
- Badge precedent: `packages/billing/src/components/invoices/InvoiceTaxSourceBadge.tsx`

## Gotchas

- `JobScheduler.scheduleRecurringJob` (`server/src/lib/jobs/jobScheduler.ts:184`)
  coerces every interval to 24 hours. The 15-minute cycle must use the
  shorter-interval path (precedent: `renew-google-gmail-watch` every 30 min)
  or fix the coercion.
- CDC overlap window (5 min) makes duplicate delivery routine — every inbound
  applier must be a no-op for already-mapped, unchanged entities.
- `invoice_payments` is EE-only today; acceptable because the QBO integration
  is EE-gated, but the shared `recordExternalPayment` service lives in EE.
- Pre-existing local test failures unrelated to this work (verified via
  `git stash` on clean tree): `xeroAdapter.spec.ts` (needs live test DB; local
  `.env.localtest` creds fail), `pageTitles.metadata.test.ts` T006/T007/T024/T026,
  `XeroIntegrationSettings.contract.test.tsx` 3/6.
- Run package tests from `server/`: `npx vitest run ../packages/...`
  (root `vitest.config.ts` include-globs don't match package paths).

## Commands

- Targeted suites: `cd server && npx vitest run src/test/unit/api/qboOAuthRoutes.test.ts`
- Typecheck a package: `cd packages/<pkg> && npx tsc --noEmit -p tsconfig.json`
- Pseudo-locales after en changes: `node scripts/generate-pseudo-locales.cjs`
