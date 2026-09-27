# Contract product schedule companion interface

The source handoff file was absent from this checkout. This file records the interface supplied in the Draft Implementation captain instructions for card `f6e7254b` / PR #3492. The companion branch owns permanent quantity/rate revisions, history, schedules, and automatic true-up generation; this card must consume its settlements without writing quantity history or generating a competing proration.

## True-up row contract

- `adjustment_source_kind = 'contract_change'`.
- `adjustment_source_id` is the canonical unit-pricing revision ID; `adjustment_source_revision` is that revision's version.
- `adjustment_scope = 'service'`; include `adjustment_base_amount` and the reason.
- Adjustment period columns are half-open `[start, end)`. Companion `invoice_charge_details` period ends are inclusive and must be normalized by adding one day before comparing with adjustment periods.
- The supplied amount is already prorated: `sign(delta) × ceil(ceil(abs(delta) × rate) × covered/full)`. Never prorate this amount again.
- Companion writes the source row onto the next eligible editable draft before the shared discount/tax pipeline.
- Reconciliation must obey the existing unique source-per-invoice constraint. The same source revision on one invoice is updated/reused on retries, never appended twice. Version is part of the semantic source identity but must not be added to the database unique key without reconciling the extant constraint.
- Applicable positive true-ups participate in discount bases and tax recalculation as service charges; credits retain their supplied sign and tax behavior. This card does not delete companion source rows during discount refresh. Manual rows are preserved. Invoice cancellation does not unlock billed/locked line history or permit historical date/text edits.

This handoff is an integration contract from captain instructions, not a claim that the companion implementation was inspected in this checkout. Confirm field names and exact retry semantics against PR #3492 before live acceptance.

## Read-only verification during takeover

The locally available remote ref was inspected at
`50ce6d41f78a2ee4186779b5d05b447c7845a5ef`. Its handoff describes the older
next-period-only policy, and its `RecurringUnitSchedulePanel` accepts line,
service, and configuration IDs but no initial effective-date property. The
invoice calculator therefore links to the selected line without pretending to
prefill that date. This ref does not contain the new mid-period settlement writer.
The captain's later `contract_change` contract above remains authoritative;
combined-branch true-up verification is still needed when that implementation is
available. No companion branch or worktree was changed.

## Implement desk interface check

The companion checkout at `558c78e26a2d8eb5fcaadf1d7063e0191dff3183` now
contains the mid-period writer. Its plan
`docs/plans/2026-09-22-contract-products-quantity-price-changes-plan.md`
records the same source kind, revision/version identity, half-open periods and
source-per-invoice retry rule as this card's plan. The earlier next-period-only
availability note above is superseded by this inspection.

`reconcileContractChangeAdjustments.ts` writes already-prorated `net_amount`
with the original unit rate and actual quantity delta. It does not create
invoice detail rows. Resolve the source line by joining the charge's
`adjustment_source_id` to `contract_recurring_unit_adjustments.revision_id`,
including tenant equality. That ledger's `contract_line_id` drives the early
UI warning, transactional overlap guard and line-scoped discount base. Read it
only when the companion table exists; retain detail-backed source resolution
for generated charges. Do not manufacture recurring coverage for a true-up.

Both branches contain the discount evaluator; merge integration must retain one
implementation and one evaluation pass. This inspection and the fabricated
ledger-row database test establish the consumer contract, not live combined-
branch acceptance. Neither the companion writer nor its working tree was edited.
