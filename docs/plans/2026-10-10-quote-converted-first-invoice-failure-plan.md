# Plan: First invoice from a quote-converted contract fails (alga0002168)

Card: alga0002168, branch `feature/alga0002168-first-invoice-from-a-quote-converted`, base `origin/main` b0d0b4dacf.

## 1. Reproduction on current main

I reproduced the reported flow with a scratch DB integration test. It drove the real server actions with only auth and tenant mocked, against an isolated database (`test_db_alga0002168`) on the `alga-psa-local-test` Postgres:

1. Client with a July 2026 monthly billing cycle and a default billing location.
2. Accepted quote: 3 recurring fixed lines ($1,500 + $2,000 + $700 = $4,200/mo) plus one one-time item, `accepted_at = 2026-07-23T15:42:10Z`.
3. `convertQuoteToContract(quoteId)`, which is what QuoteDetail and QuoteForm call.
4. `activateClientContractForBilling(clientContractId)`, which is what Client Contracts > Set to Active calls since dbaeebaa08.
5. `getAvailableRecurringDueWork`, then `repairAllRecurringServicePeriodsForTenant` ("Fix all"), then `previewGroupedInvoicesForSelectionInputs` and `generateGroupedInvoicesAsRecurringBillingRun`, then `deleteContract`.

### Observed

| Variant | Result |
|---|---|
| As shipped | After Set to Active the contract header is `active` and the assignment is active, but **all 3 contract lines are still `is_active = false`**. No `recurring_service_periods` exist. Due work returns **no invoice candidates** and **3 `missing_service_period_materialization` gaps** for July, with the copy "This client's billing schedule changed…". **Fix all is a no-op** (`clientsScanned: 1, clientsRepaired: 0, rowsBackfilled: 0`), so the gaps never clear and the client can never be invoiced. |
| As shipped, client also has a healthy active contract | That contract's June/Aug/Sep/Oct windows are invoiceable, but **its July window disappears from the candidates**. The quote lines' July gaps block the whole client window (`applyClientCadenceMaterializationGapBlocks`, keyed by client + invoice window). Converting a quote takes the client's other recurring invoice hostage. |
| Lines forced `is_active = true` before Set to Active | Sync materializes July through October. The **July first period previews and generates correctly** (advance timing), and an invoice is produced. This confirms the inactive lines are the root cause on main. |
| Lines forced active plus an injected DB failure on `invoice_charges` insert | Run returns `failures: [{ errorMessage: "Failed to generate invoice for this billing cycle." }]` and no code. The real cause appears only in the server log. This is the generic sentence from the card. |
| Delete after the gap state, or after a failed generation | `deleteContract` succeeds and the contract is gone. Delete after a **successful** invoice correctly refuses with the keyed `msp/contracts:errors.contract.hasInvoices` message. |

The report itself (July) predates dbaeebaa08 and the current gap blocking. The underlying defect is the same: converted lines never become active, so their periods are never materialized. I believe, but have not reconstructed, that in July this surfaced as a "Ready" window. The engine then threw a then-unmapped "not materialized" error inside generation, and the run's catch turned it into the generic sentence. On main the same defect shows up earlier as a permanent, unrepairable gap. Either way, the first invoice never generates.

## 2. Root cause

Quote conversion is the only creation path that marks a draft contract's **lines** inactive, and nothing ever reactivates them:

- `packages/billing/src/services/quoteConversionService.ts` `convertQuoteToDraftContract` writes `contract_lines.is_active: false` (line ~712) and `client_contracts.is_active: true` (line ~833) on a `status: 'draft'`, `is_active: false` contract header.
- The workflow-runtime copy `shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts` `convertQuoteToDraftContract` (~1268) writes the same shape (`is_active: false` lines at ~1349, `is_active: true` assignment at ~1468).
- The contract wizard models a draft differently: header `draft`/`is_active=false`, assignment `is_active = !isDraft`, and lines active. Lines are inserted through repositories with `is_active ?? true`. Every other creation path leaves lines active. On the local DB, 107 of 108 non-quote lines are active, and all 18 quote-converted lines are inactive.
- `shared/billingClients/clientContracts.ts` `activateClientContractAssignment` promotes the header and the assignment only.
- Client-cadence materialization (`loadClientCadenceRecurringObligations` in `shared/billingClients/clientCadenceScheduleRegeneration.ts`) and contract-cadence sweep (`contractCadenceServicePeriodMaterialization.ts` ~728) require `cl.is_active`, so no periods are produced.

There is a second, independent defect that turns this into a client-wide outage. **Gap detection and materialization disagree on what a live recurring line is.** `fetchClientCadenceMaterializationGaps` (`packages/billing/src/actions/billingAndTax.ts` ~541) filters only `cc.is_active`, non-system-default, `cadence_owner = 'client'`, and non-null frequency/timing. It ignores `ct.is_active` and `cl.is_active`. So it reports gaps that materialization by design will never fill. Those gaps block every candidate in the same client window, and Fix all cannot repair them. A just-converted draft quote contract triggers the same thing, because its assignment is written active.

## 3. Design

### D1. One representation of a draft contract (root-cause fix)

A contract is a draft when its header is `status = 'draft'` and `is_active = false`, and its assignment is inactive. Lines are always written active, because line `is_active` means "the line is enabled", not lifecycle state. This matches the wizard. The fix is to make quote conversion conform to it, not to teach activation to flip lines: activation flipping every line would silently reactivate any line someone deliberately disabled.

- `quoteConversionService.convertQuoteToDraftContract`: write lines `is_active: true` and the assignment `is_active: false`.
- `crmWorkerDal.convertQuoteToDraftContract`: same change. Add `// LEVERAGE: pattern quote-to-contract-conversion — workflow runtime duplicates packages/billing quoteConversionService; this bug had to be fixed twice` at both sites.
- `activateClientContractAssignment` needs no change. It already flips the header and assignment, and `activateClientContractForBilling` already resyncs periods inside the same transaction. Once lines are active, that sync materializes the first period. The repro's forced-active variant shows this.
- Callers that assumed a converted draft's assignment is active: check `deriveClientContractStatus` (draft wins on `contractStatus === 'draft'`, so the display is unchanged), the Client Contracts row-menu gating for Set to Active / Delete / Discard draft, and the quote "converted contract" views. Fix any that branch on the assignment's `is_active` for drafts. Writing the assignment inactive for drafts also stops cc-only readers from treating a draft quote contract as live once its lines are active: the billing engine's time-entry line match at ~2550 and `loadContractCadenceObligations` at ~369 both filter only `cc.is_active`.

### D2. Gap detection uses the materializer's eligibility rule

Extract the client-cadence "live recurring obligation" predicate into `shared/billingClients`, for example `whereLiveClientCadenceRecurringLine(query)`. It covers `cc.is_active`, `ct.is_active`, `cl.is_active`, non-system-default, `cadence_owner = 'client'`, and non-null timing. Use it in both `loadClientCadenceRecurringObligations` and `fetchClientCadenceMaterializationGaps`. Gap detection keeps its own extra `billing_frequency IS NOT NULL`. With this, a gap is only reported when Fix all can actually fill it, and a draft or disabled line can no longer block a client's window. Mark the remaining cc-only readers (engine ~2550, `loadContractCadenceObligations` ~369) with `// LEVERAGE: friction live-recurring-line-predicate — eligibility re-derived per reader` rather than widening scope.

### D3. Data repair migration for existing quote-converted contracts

New `server/migrations/<ts>_activate_quote_converted_contract_lines.cjs` (create via `npx knex migrate:make … --env migration`, use the `utils/tenantDb.cjs` shim, Citus-safe, no column-reference functions in UPDATE):

- For contracts with `template_metadata->>'conversion_kind' = 'quote_to_contract'`, set `contract_lines.is_active = true` where it is false. Select the ids first, then do parameterized updates per tenant. This is safe because conversion is the only writer of inactive lines for these contracts, and no UI toggles a line's `is_active`. The implementer must confirm that last point with a grep before relying on it.
- For those contracts whose header is still `status = 'draft'`, set `client_contracts.is_active = false` so existing drafts match D1.
- Periods for already-activated converted contracts are not materialized in SQL. After D2, Fix all (`repairAllClientCadenceServicePeriodsForTenant`) finds and backfills them, and that is the documented recovery step. A test must prove that Fix all after the migration produces the July row and the first invoice.

### D4. Generation surfaces the real, coded failure (parity with PR #3555 preview)

Today preview and generation classify the same engine sentences in two places. `EXPLAINED_PREVIEW_FAILURES` is used by preview only. `invoiceGenerationActionErrorFrom` returns uncoded raw English for `Nothing to bill` and `Recurring service periods were not materialized…`, and it never recognizes `No active contract lines found…`. The run's `catch` then flattens anything else to the generic sentence.

- In `packages/billing/src/actions/invoiceGeneration.ts`, have `invoiceGenerationActionErrorFrom` return keyed action errors for the three explained failures. Use new message keys in `invoiceGeneration.constants.ts`, for example `RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY`, `NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY` and `NOTHING_TO_BILL_MESSAGE_KEY`, with the same actionable English as preview. Preview then reads its code from that one table (`explainedPreviewFailureFromMessage` stays the single matcher). Existing `LEVERAGE: friction engine-failure-identity` marker stays.
- In `recurringBillingRunActions.ts`, add the three keys to `handledRecurringFailureFromActionError`.
- Both catch blocks (~407 single, ~877 grouped) keep `logRecurringBillingRunInvoiceFailure`, then classify the thrown error:
  - If `invoiceGenerationActionErrorFrom` maps it, use the mapped message and code. This covers errors thrown outside the `withInvoiceGenerationActionErrors` boundary.
  - Otherwise generate an 8-character `ref`, log it with the failure, and push `{ code: 'UNEXPECTED', params: { ref }, errorMessage: 'Something went wrong generating the invoice. Quote reference <ref> when contacting support.' }`.
  - Factor one helper, `recurringRunFailureFromThrown(err, ctx)`, used by both blocks. The two copies are the duplication this card trips over.
- Add `'UNEXPECTED'` to `RecurringInvoiceFailureCode` (`packages/types/src/interfaces/invoice.interfaces.ts`). The UI already translates it through `translateManualInvoiceFailure` → `manualInvoices.errors.UNEXPECTED` (exists in en and all locales), so `localizeRecurringFailure` renders it without component changes. Raw exception text never reaches the user.
- Preview's unknown-error branch ("An error occurred while previewing the invoice") gets the same `UNEXPECTED` + ref treatment so both buttons tell the operator something they can act on or hand to support.

### D5. Delete of a quote-converted contract

Retest: delete works after both a failed generation and the gap state, and refuses with a keyed message once an invoice exists. No code fix is needed for the reproduced paths. Hardening for the "fails silently" report: `deleteContract`'s unmapped-error branch rethrows today. Next masks thrown server-action messages in production, so the toast loses the reason. Return a keyed generic action error with a logged ref instead, matching D4. Cover all three delete outcomes in tests.

### D6. Gap copy

Gaps for a new or just-activated contract are not "billing schedule changed". After D1/D2 the quote case no longer produces gaps, so this card does not need new copy. Note it as follow-up only.

## 4. Files to change

| File | Change |
|---|---|
| `packages/billing/src/services/quoteConversionService.ts` | D1: lines active, assignment inactive for drafts; LEVERAGE marker |
| `shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts` | D1: same; LEVERAGE marker |
| `shared/billingClients/clientCadenceScheduleRegeneration.ts` (or a new `liveRecurringLinePredicate.ts` in `shared/billingClients`) | D2: shared predicate; used by `loadClientCadenceRecurringObligations` |
| `packages/billing/src/actions/billingAndTax.ts` | D2: `fetchClientCadenceMaterializationGaps` uses the shared predicate |
| `packages/billing/src/lib/billing/billingEngine.ts`, `packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts` | D2: LEVERAGE friction markers only |
| `server/migrations/<ts>_activate_quote_converted_contract_lines.cjs` (+ shim metadata if needed) | D3 |
| `packages/billing/src/actions/invoiceGeneration.constants.ts` | D4: three new message keys |
| `packages/billing/src/actions/invoiceGeneration.ts` | D4: keyed explained failures in `invoiceGenerationActionErrorFrom`; preview `UNEXPECTED` + ref |
| `packages/billing/src/actions/recurringBillingRunActions.ts` | D4: key→code mapping; `recurringRunFailureFromThrown` used at both catches |
| `packages/types/src/interfaces/invoice.interfaces.ts` | D4: `'UNEXPECTED'` in `RecurringInvoiceFailureCode` |
| `packages/billing/src/actions/contractActions.ts` | D5: keyed generic error instead of rethrow |
| `server/public/locales/*/msp/*.json` | Only if a new user string is added (D5 generic delete key). Every locale incl. xx/yy. |

## 5. Regression coverage

New `server/src/test/integration/billing/quoteConvertedFirstInvoice.integration.test.ts`. Use the scaffolding from `billingProfileAttribution.integration.test.ts` and a dedicated `databaseName`, and drive the real actions as in §1:

1. **First invoice end-to-end:** convert (3 recurring fixed lines + 1 one-time item), then assert lines active and assignment inactive before activation. Set to Active, then assert July periods exist, no gaps for the client, and a July candidate with `canGenerate`. Preview succeeds with $4,200 subtotal and generate creates exactly one invoice for July; the one-time item is not on it.
2. **Draft does not block siblings:** a client with a healthy contract plus a converted, not-yet-activated quote contract. The healthy July window stays a candidate and there are no gaps.
3. **Legacy data repair:** build a converted contract in the old shape (lines inactive, already activated), run the migration's up function, then Fix all. Assert the July candidate and the invoice generate.
4. **Generation surfaces the cause:** (a) a selection whose periods are missing returns `code: 'RECURRING_PERIODS_NOT_MATERIALIZED'`. (b) An injected DB fault (the trigger pattern from billingProfileAttribution) returns `code: 'UNEXPECTED'` with `params.ref`, the ref appears in the logged failure, and `errorMessage` is not the old generic sentence. Cover both the single and grouped run paths.
5. **Delete:** after a failed generation the contract is deleted. After a generated invoice, `deleteContract` returns `messageKey: 'msp/contracts:errors.contract.hasInvoices'`.

Unit tests:
- `invoiceGenerationActionErrorFrom` maps the three engine sentences to keyed errors.
- `handledRecurringFailureFromActionError` maps the keys to codes.
- `recurringRunFailureFromThrown` covers unmapped → `UNEXPECTED` with ref.
- `shared/billingClients/__tests__`: the shared predicate excludes an inactive header and an inactive line.
- Extend `server/src/test/integration/contractServicesPerSeatQuote.integration.test.ts` to stop hand-activating lines and instead activate through `activateClientContractForBilling`. That test currently sets `contract_lines.is_active = true` by hand, which is why this bug stayed green.

Run with `DB_HOST=127.0.0.1 DB_PORT=5472` (direct Postgres; the harness drops and recreates the DB) plus the admin and server passwords from `secrets/`.

## 6. Out of scope

- Proration of the first period: conversion writes `enable_proration: false`. A Jul 23 start bills the full July period, which is existing quote semantics.
- Collapsing the workflow-runtime conversion copy into one implementation (marked LEVERAGE).
- Gap panel copy for genuinely new schedules (D6).
