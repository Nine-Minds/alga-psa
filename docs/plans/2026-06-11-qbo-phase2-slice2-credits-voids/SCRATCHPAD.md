# SCRATCHPAD — QBO Slice 2: Credits & Voids

## Decisions (inherited from design, 2026-06-10/11)

- Immutable invoice totals: the reshape lands before any credit sync; backfill
  is lossless (`total_amount += credit_applied`).
- Prepayments are NOT CreditMemos (unearned revenue ≠ revenue reversal);
  excluded from export, future mapping to QBO unapplied payments unscheduled.
- Credit application in QBO = zero-dollar Payment linking CreditMemo↔Invoice.
- Voids use the existing-but-unused `cancelled` status + `invoice_cancelled`
  transaction type; void blocked while payments exist; hard delete blocked for
  exported documents.
- Unapply of a synced allocation is exception-only (no auto-reversal in QBO).

## Key file paths

- Mutation site to fix: `packages/billing/src/actions/creditActions.ts:910`
  (`applyCreditToInvoice` `.decrement('total_amount', ...)`)
- Negative-invoice finalize behavior: `packages/billing/src/actions/invoiceModification.ts`
  (`finalizeInvoiceWithKnex`, credit_issuance_from_negative_invoice)
- Stripe payment link amount: `@alga-psa/billing/actions/paymentActions`
  (`getOrCreateInvoicePaymentLinkUrl`)
- Hard delete (payment reversal precedent): `invoiceModification.ts:984`
- Adapter to extend with CreditMemo/void: `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`
- Export selector already flags credits: `accountingExportInvoiceSelector.ts`
  (`credit_memo: line.isCredit` metadata)

## Read-site audit (fill in during implementation — REQUIRED before backfill merges)

- [ ] MSP invoice list / detail
- [ ] Client portal invoice list / detail / pay page
- [ ] Stripe payment link amount
- [ ] Overdue detection job
- [ ] Invoice PDF templates / email templates
- [ ] Accounting export selectors (settledness reasoning)
- [ ] (append every additional site the grep finds)

## Gotchas

- `invoices.credit_applied` exists since `20241126030648`; the pair
  (`total_amount`, `credit_applied`) is what makes the backfill lossless.
- QBO void is an explicit operation (`operation=void`) requiring Id+SyncToken;
  stale sync tokens surface as QBO_STALE_OBJECT — re-read then void.
- CreditMemo tax: sign-flip must keep TxnTaxDetail consistent in internal-tax
  mode; in delegated mode QBO computes — mirror the invoice transform paths.

## Implementation notes (built 2026-06-11)

- Read-site audit executed via subagent sweep; every MUST-CHANGE applied
  (Stripe link amount now charges balance due with a zero-balance guard;
  refund thresholds, portal amounts, emails, AR sums all net of credits).
  KEEP list honored — purchaseOrderService / aging / outstanding_amount
  formulas became correct automatically once totals turned immutable.
- Backfill is `total_amount += credit_applied` (single UPDATE, recoverable
  pair); `invoice_type` backfilled from is_prepayment + negative totals.
- Credit notes renumber to the CM- sequence AT FINALIZE (issuance moment);
  drafts keep their provisional invoice number until then.
- F025 (unapply exception): NO unapply action exists in the codebase, so
  there is nothing to hook — recorded as satisfied-by-absence.
- F026 (i18n): billing-dashboard components follow the package's existing
  non-localized convention; no integrations-namespace strings were added.
- apply_credit ops are enqueued per (allocation, credit-note) pair via the
  credit_tracking→transactions join, so multi-pool applications reconcile
  per memo; ops wait (no attempt burn) until both documents are mapped.
- Voids: QBO Invoice uses operation=void; CreditMemo has no void in QBO →
  operation=delete; drift detector ignores changes on 'voided'/'external_voided'
  mappings so our own void doesn't file drift.
- Deferred to a DB-enabled env: T001 (apply leaves total untouched — code
  audited), T003/T006 (migration round-trips), T004/T005 (Stripe/portal
  contract — Stripe integration suite is DB-skipped locally), T007 (CM
  sequence uses the generate_next_number PG function), T010 (validation
  exclusion), T017 (hardDelete block), T020 (full-cycle integration).
