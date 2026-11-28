# Finalize derives invoice status from recorded payments

Ticket: alga-2026-0003329

## Problem

An invoice that has recorded payments can be unfinalized. That is allowed, and should stay allowed, as long as the invoice has not been exported to an accounting system: `assertInvoiceNotExported` already blocks unfinalize once an invoice is mapped or delivered to QBO/Xero, or while an export batch is being prepared.

What goes wrong is the trip back. Unfinalize sets the invoice to `draft` and leaves its `invoice_payments` rows in place (correctly: the money was received). Finalize then writes `status: 'sent'` unconditionally (`finalizeInvoiceWithKnex`, `packages/billing/src/actions/invoiceModification.ts`). A fully paid invoice comes back from unfinalize/finalize as `sent`, showing a balance due that the client has already paid. The Finalized tab, the client portal, auto-pay, payment links and dunning all read that status.

Two related gaps make the round trip worse:

- Credit auto-apply after finalize computes its headroom as `total_amount - credit_applied` and ignores payments, so a re-finalized paid invoice can draw down client credit for an amount nobody owes.
- While the invoice is a draft, nothing on the draft shows that payments are recorded against it, so the MSP cannot see why it should not cut the total, and the invoice looks unpaid.

Production evidence (2026-11-24): 3 invoices across 2 tenants carry payments that fully cover them while their status says otherwise: 2 drafts that were unfinalized after payment, and 1 `sent` invoice that was unfinalized and finalized again after payment.

## Goal

Invoice payment status is derived, in one place, from the invoice's total, credit applied and net recorded payments. Every path that changes any of those inputs or the lifecycle (finalize, payment recorded, payment reversed, credit applied) uses that one derivation. Unfinalize → edit → finalize is then safe without a special guard.

## Non-goals

- Blocking unfinalize on invoices with payments. Decided against (Robert, 2026-11-24): the export guard is the correct boundary.
- Converting an overpayment into client credit. Today a confirmed manual overpayment is recorded as-is and the invoice reads `paid` with a negative balance. A draft edited below the amount paid ends in the same state and is treated the same way. An overpayment-to-credit mechanism would serve both, and is separate work.
- Changing the invoice PDF or templates to show paid status.

## Users and flows

MSP billing staff (Admin, Finance):

1. A client pays an invoice through Stripe or the MSP records a manual payment. The invoice is `paid`.
2. The MSP unfinalizes it to fix a line (not yet exported).
3. The draft shows that a payment of X is recorded against it, and warns if the edited total falls below the amount paid.
4. The MSP finalizes again. The invoice comes back `paid` (or `partially_applied` if the new total exceeds what was paid). No client credit is drawn for the part already paid.

## Design notes

- Extract the status derivation now private to `recordExternalPayment.ts` (`resolveStatus`) into a pure function next to `computeBalanceDue` in `packages/billing/src/lib/balanceDue.ts`, taking the lifecycle state as an input (draft/cancelled/void are lifecycle states and are never overwritten by payment status). `recordExternalPayment` (record and reverse), finalize, and credit application all call it.
- Finalize: inside its existing transaction, after the identity updates, read net payments for the invoice and write the derived status instead of `'sent'`. The audit row's `after.status` records the derived status.
- Credit auto-apply headroom after finalize uses `computeBalanceDue` (total minus credit applied minus net payments), not `total - credit_applied`.
- Credit application (`applyCreditToInvoiceInternal`) sets status through the same derivation, if it sets status at all today (check, see scratchpad).
- Draft invoice view: when the draft has recorded payments, show the net amount paid, and warn when the draft total is below it. Use the existing invoice payment summary (`getInvoicePaymentSummary`) rather than a new query path.
- One-time data repair: a migration recomputes status for finalized, non-cancelled, non-void invoices that have recorded payments and whose stored status disagrees with the derivation. Drafts are left alone; they correct themselves when finalized. Must be Citus-safe (no `now()` inside CASE/COALESCE; see the `citus-migration-gotchas` skill).

## Risks

- Finalize has four callers: the UI action, `InvoiceService` (REST), recurring invoice generation, and prepaid auto-replenishment. All must get the derived status. For a freshly generated invoice payments are zero and the result is `sent`, as today.
- Credit-note and prepayment invoice types: confirm the derivation does not turn a credit note or negative-total invoice `paid` because its balance is ≤ 0 with zero payments. Today's rule requires `totalPaid > 0` for `paid`; keep that.
- Workflow and accounting consumers that key off `status === 'sent'` right after finalize (e.g. invoice email sending, payment links). A finalized-and-already-paid invoice should not get a pay link; `invoiceEmailLinkContext` already omits links for paid invoices.

## Acceptance criteria

- Unfinalize → finalize on a fully paid, unexported invoice yields `paid`; on a partially paid one, `partially_applied`; on an unpaid one, `sent`.
- Raising a paid draft's total and finalizing yields `partially_applied` with the correct balance due; lowering it below the amount paid yields `paid` with a negative balance, matching a confirmed overpayment.
- Re-finalizing a paid invoice draws no client credit.
- A draft with recorded payments shows the amount paid and warns when its total is below it.
- After the migration, no finalized, non-void invoice has a status that disagrees with its recorded payments.
- Unfinalize stays blocked for exported invoices (unchanged).
