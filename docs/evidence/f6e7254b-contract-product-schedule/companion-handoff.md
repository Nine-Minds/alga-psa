# Recurring pricing and invoice settlement handoff

This branch owns recurring quantity/rate history. The invoice card `b97eda7b`
owns discount allocation and authorized invoice adjustments. The revision store
is the pricing authority; settlement must not derive a change from the live
configuration columns or overwrite revision history.

The companion was inspected read-only at `a0656bc53f` on 2026-09-23. Its
`services/invoiceAutomaticAdjustments.ts` reads persisted invoice charges and
coverage through invoice details, then calls
`lib/billing/compute/contractInvoiceAdjustments.ts`. It does not yet consume this
branch's `effective_pricing` fingerprint. Neither branch was merged into the other.

## Data contract

| Information | Current source |
| --- | --- |
| Tenant and invoice | `invoice_charges.tenant`, `invoice_id` |
| Assignment, service, charge identity | `invoice_charges.client_contract_id`, `service_id`, `item_id` |
| Configuration and covered service dates | `invoice_charge_details.config_id`, `service_period_start`, `service_period_end` |
| Quantity and billed amount | Persisted charge/detail quantity, unit price and net amount; do not read live configuration quantity |
| Scheduled source | `invoice_charge_details.effective_pricing`: revisionId, version, effectivePeriodStart, pricePolicy, unitRateCents, catalogPriceId, catalogEffectiveDate |
| Preview lock | `expectedRecurringPricingSources`, keyed by line/config/service and covered dates; an empty array is a reviewed empty set |
| Currency | Invoice currency; the catalog source has already been selected for that contract currency and period |
| Discount source and allocation | Companion `adjustment_provenance` and `adjustment_source_*` on invoice charges |

Canonical recurring service periods use half-open ends. Persisted invoice detail
rows currently use the legacy inclusive last covered day (the August smoke row
ends August 31, while its recurring period ends September 1). Preserve the existing
adapter when deriving day counts; do not treat these endpoints as interchangeable.

A catalog source is resolved before settlement. The full quantity replaces the
previous quantity from its boundary onward; it is not an incremental adjustment.
For partial contract coverage, the engine's existing coverage calculation resolves
the charge amount before discounts. Settlement must not prorate that amount again.

## Amendment (2026-09-27): opt-in mid-period quantity true-up

Boundary-only changes remain the default. With an explicit per-change opt-in,
this branch now records a quantity-only change inside an eligible unbilled
period and emits exactly one automatic `contract_change` adjustment. The
canonical revision keeps the next boundary as `effective_period_start` (the new
standing quantity begins there) and stores `mid_period_effective_date`; a durable
ledger (`contract_recurring_unit_adjustments`) holds the signed true-up and is
materialized as a source-linked `invoice_charges` row on the next eligible
editable draft.

Agreed source identity for the companion evaluator:

| Information | Value |
| --- | --- |
| `adjustment_source_kind` | `contract_change` |
| `adjustment_source_id` | the canonical revision id |
| `adjustment_source_revision` | the revision version at settlement |
| `adjustment_scope` | `service` |
| `adjustment_base_amount` | `abs(quantity delta) × unit rate` (minor units) |
| `adjustment_reason` | direction, quantities and `covered/full` days |
| `adjustment_period_start` / `_end` | affected canonical period, half-open |

Amount convention: `sign(delta) × ceil(ceil(|delta| × unit rate) × covered/full)`,
the engine's existing coverage-proration rounding. Increases are charges;
decreases are credits. A mid-period change may not change the unit price: the
rate is the one in force for the affected period (override or currency/period
catalog). The resolved amount joins the invoice's charges before the shared
discount and tax pipeline, so it is discounted and taxed once and is never
prorated again. Editing a pending revision version reconciles the same
`invoice_charges` row; a repeated generation cannot insert a second settlement.

The companion still owns the invoice-side manual partial-period calculator, its
link to the contract scheduler, and its overlap warning. This branch adds no
invoice-side contract-quantity writer. When the companion's
`evaluateContractInvoiceAdjustments` is merged, it can consume these
source-linked rows directly (its `is_eligible` rule already excludes negative
credit lines from the positive discount base) instead of this branch's existing
discount pipeline.

Under the default (no opt-in), a 20-to-23 change at $100 still changes the next
full-period gross subtotal from $3,900 to $4,200 without a credit or separate
true-up line. Stopping uses a zero revision and retains provenance/history.

## Integration requirements

1. Retain this branch's revision validation, locking, compare-and-set history and
   preview fingerprint when integrating invoice settlement. The companion does not
   need a second effective-history store.
2. Feed already resolved recurring charge rows to the companion's evaluator once.
   Replace the legacy discount calculation/persistence together with its preview
   counterpart. Do not run both legacy discount lines and companion reconciliation.
3. Preserve detail `effective_pricing` when refreshing draft invoices. Keep the
   invoice's covered service dates as the discount eligibility window; invoice issue
   date and current configuration are not substitutes.
4. Both preview and generation must call the same settlement evaluator. This branch
   now includes legacy automatic discount lines in previews, matching generation's
   signed rounding. The companion changes allocation/tax policy and must replace
   both sides together.
5. Verify combined-branch fixed and percentage discounts, scope/expiry, tax,
   zero-subtotal handling, retry idempotency and stale-source rejection before merge.
   This branch's tests prove the existing pipeline; they do not prove a combined build.

## Behavioral evidence on this branch

`contractQuantityUsageSemantics.test.ts` exercises real actions and persistence:
20/30/2 to 23/30/2; inherited catalog changes; stored source/version and quantity;
fixed and percentage discount lines; historical invoice preservation; stale empty
single/grouped previews; repeated generation; zero-period completion; and proposed
revision previews whose revision/history writes are rolled back. The proposal
preview includes discounts/tax and returns errors without fabricated totals.

A read-only check also passed the actual persisted August/September charge rows
from the live smoke to the companion's `evaluateContractInvoiceAdjustments` at
`a0656bc53f`. One invoice-scoped 10% discount produced $3,510/$3,780; one $100
fixed discount produced $3,800/$4,100. Each result contained one discount, and
repeated evaluation returned identical allocations. Results are recorded in
`takeover-companion-evaluator.json`. This proves the resolved-charge shape works
with its pure evaluator, not its settlement persistence, tax or combined build.

The companion's adoption and combined-branch validation remain integration work.
This ownership and field mapping define this branch's handoff; they do not claim
agreement from a companion agent or authorize changes to its worktree.
