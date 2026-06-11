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
