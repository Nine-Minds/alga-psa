# Reporting And Analytics Date-Basis Policy

Recurring service-period-first billing makes date basis an explicit product rule instead of an accidental side effect of whichever table a reader touched first.

## Policy Matrix

| Reporting family | Primary surfaces | Authoritative date basis | Historical / fallback rule | Notes |
| --- | --- | --- | --- | --- |
| Billing overview and invoice summary surfaces | client portal overview cards, recent invoice activity, invoice list summaries, payment-success summaries | invoice-window and invoice-header dates for operational state; canonical recurring service-period summaries only as explanatory recurring coverage metadata | if canonical recurring detail rows are absent, keep invoice-header / financial-document semantics and label the artifact accordingly | Do not silently reinterpret pending, overdue, or unpaid states as service-period metrics. |
| Contract revenue reporting | contract revenue report, contract summary YTD cards, revenue report definitions | `invoice_charge_details.service_period_end` when canonical recurring detail rows exist | fall back to `invoices.invoice_date` for historical flat invoices or manual rows without canonical detail periods | Revenue is the main reporting family that pivots to billed service-period semantics. |
| Contract expiration and renewal-decision reporting | contract expiration report, renewal decision summary cards | `client_contracts.end_date` and renewal `decision_due_date` | no service-period fallback because this family is assignment-timeline based, not invoice-timing based | Expiration remains assignment / renewal workflow reporting even after recurring invoice timing changes. |
| Credit reconciliation and discrepancy reporting | reconciliation report lists and summary counts | `credit_reconciliation_reports.detection_date`, discrepancy status, and transaction / expiration financial dates | canonical recurring service-period lineage may appear additively for explanation, but it does not drive report totals or aging buckets | Reconciliation stays financial-control reporting, not service-period reporting. |
| Financial analytics and collections-style aggregates | financial analytics API, invoice-count and net-revenue trends, credit issuance/application analytics | `invoices.created_at`, `invoices.due_date`, `invoices.finalized_at`, and `transactions.created_at` depending on the metric | no recurring service-period fallback unless a later analytics plan explicitly redefines that metric | These surfaces answer financial-operational questions, not coverage-window questions. |
| Service metrics and recurring coverage summaries | recurring invoice detail summaries, billed-service-period cards, recurring allowance summaries | canonical recurring service periods and explicit allowance periods | if canonical detail rows are absent, show financial-only fallback copy rather than synthesizing service periods from headers | These surfaces are allowed to diverge from invoice-date views because they are intentionally coverage-based. |

## Mixed-Cadence Rule

When invoice dates and recurring service periods diverge because client-cadence and contract-cadence work coexist:

- financial-operational surfaces keep their invoice-header or transaction-date basis
- recurring coverage surfaces keep canonical service-period basis
- readers must label which basis they are showing instead of flattening one into the other silently

Recent invoice activity is one of the portal surfaces that may display canonical recurring coverage summaries, while pending-invoice counts remain invoice-state metrics.

## Implementation Notes

- Prefer canonical recurring service periods only for readers whose product question is "what coverage was billed?"
- Prefer invoice-header, due-date, finalized-date, or transaction-date semantics for readers whose product question is "what financial document was issued, due, paid, expired, or reconciled?"
- Historical flat invoices remain valid inputs; do not synthesize canonical service periods for them just to satisfy a reporting shape.
