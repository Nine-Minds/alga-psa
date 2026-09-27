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
