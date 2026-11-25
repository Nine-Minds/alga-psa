# Scratchpad

## Origin

Ticket alga-2026-0003329. A tenant's Stripe payments were all recorded (webhooks processed, invoices flipped to paid, Payment Received emails sent). The "unpaid" appearance was the Finalized tab's hard-coded badge, fixed in PR #4420. While checking that tenant's data, two invoices turned up in the wrong state, both from unfinalizing after payment. This plan covers that.

## Decisions

- 2026-11-24, Robert: unfinalizing a paid invoice is allowed when the invoice has not been exported to accounting. `assertInvoiceNotExported` (packages/billing/src/services/accountingSync/invoiceExportGuards.ts) is the boundary. Do not add a payments guard to unfinalize.
- Overpaid after edit: same outcome as a confirmed manual overpayment (status paid, negative balance). Overpayment → credit is out of scope.

## Code map (origin/main, 2026-11-24)

- finalize: `finalizeInvoiceWithKnex` in packages/billing/src/actions/invoiceModification.ts (~L1118). Hard-coded `status: 'sent'` at ~L1246; audit `after.status: 'sent'` at ~L1409; post-commit credit auto-apply at ~L1425 uses `total_amount - credit_applied`.
- finalize callers: invoiceModification.ts `finalizeInvoice` action, server/src/lib/api/services/InvoiceService.ts ~L1315, packages/billing/src/actions/invoiceGeneration.ts ~L3799, server/src/lib/eventBus/subscribers/prepaidAutoReplenishment.ts ~L317.
- unfinalize: `unfinalizeInvoice` ~L1612. Sets draft, reverses credit applications, leaves invoice_payments.
- status derivation today: private `resolveStatus` / `applyStatus` in packages/billing/src/services/accountingSync/recordExternalPayment.ts (~L123-147).
- balance: `computeBalanceDue` in packages/billing/src/lib/balanceDue.ts (pure; also used by AutopayService, invoicePaymentActions, paymentApplier).
- credit application: `applyCreditToInvoiceInternal` in packages/billing/src/actions/creditActions.ts ~L842. It returns `appliedInvoiceStatus`; check whether it writes status and with what rule (F006).
- payment summary for the draft UI: `getInvoicePaymentSummary` in packages/billing/src/actions/invoicePaymentActions.ts.
- delete already refuses to destroy recorded payments (invoiceModification.ts ~L2684); good precedent.

## Prod evidence query (read-only)

```sql
with p as (select tenant, invoice_id, sum(amount) paid from invoice_payments group by 1,2)
select i.status, (i.finalized_at is null) as unfinalized,
  case when p.paid >= i.total_amount - coalesce(i.credit_applied,0) then 'fully_paid' else 'part_paid' end as coverage,
  count(*) invoices, count(distinct i.tenant) tenants
from invoices i join p on p.tenant=i.tenant and p.invoice_id=i.invoice_id
where p.paid > 0 and i.status not in ('paid','partially_applied','cancelled','void')
group by 1,2,3;
```

2026-11-24 result: draft/fully_paid 2 invoices in 2 tenants; sent/fully_paid (finalized) 1 invoice in 1 tenant. The invoice audit trail (audit_logs, table_name='invoices', operations invoice_finalized / invoice_unfinalized) shows each was unfinalized from `paid`.

## Gotchas

- Migration runs on single-node Citus in prod: bind timestamps rather than calling now() inside CASE/COALESCE, and keep the join to invoice_payments on (tenant, invoice_id). See the citus-migration-gotchas skill.
- `updated_at` on finalize/unfinalize is written as a plain date, not a timestamp; don't rely on it for ordering.
