# Scratchpad — Contract quantity and usage semantics

- Created: 2026-09-04
- Scope: revised design; implementation has not been completed against this revision.

## Decisions

- The user authorized updating the plan from the design review without another interview. This revision supersedes the original XO design packet where they differ. This planning session does not advance the workflow or mutate customer billing data.
- Recurring seats use explicit quantity-times-unit-rate pricing on Fixed lines, without usage records. Existing fixed bundle prices retain their own semantics.
- Usage remains record-driven. Distinguish additive consumption entries from one replaceable period total. A period total does not carry forward.
- Preserve existing additive entries and their per-entry minimum/tier behavior. Period totals apply minimum/tiering once to the effective total. Never silently reinterpret legacy entries or minimums.
- Recurring quantity/rate changes and mode transitions take effect at a displayed next unbilled service-period boundary. Mid-period seat true-ups are outside this revision.
- Currency totals stay separate by currency; no implicit FX conversion.

## Evidence and constraints

- Original design existed as the XO Design Session review packet, not a committed plan folder. Source run: `4d5f6407-50c8-48a3-80cc-5360d2c4534e`; workflow card: `ce36c216-6319-41f9-a523-a89a6de4b8db`. These are workflow identifiers, not customer record IDs.
- `computeUsageBasedCharges.ts` maps each record to a charge and applies minimum/tiering inside the map. Two entered counts are currently additive.
- `computeFixedCharges.ts` prioritizes a line-level rate over a quantity-derived total; quantity fallbacks also use `|| 1`. Verify explicit unit pricing and zero quantities rather than assuming existing Fixed lines implement the seat workflow.
- `AutomaticInvoices.tsx` deep-links only client/service filters. `UsageTracking.tsx` resets Add Usage fields and defaults its date to today. Carry period and attribution into the form itself.
- `billingEngine.ts` identifies missing usage from uninvoiced records, which cannot distinguish never-recorded from already-invoiced usage without a separate diagnostic query.
- `contractActions.ts` suppresses legacy usage quantities; the revised requirement is a visible non-billing reference.
- Contract reports still sum line-level rates and format summary values in tenant currency. Variable-usage flags alone do not establish correct fixed-unit MRR or mixed-currency aggregation.
- Branch baseline includes `94d3ec96e8` and follow-ups through `b867c21c2b`. Latest card facts report successful date/selector checks; the older smoke summary remains failed. Neither proves the new period-total and recurring-seat requirements.

## Implementation sequencing

1. Add explicit pricing/measurement semantics and effective-period boundaries with compatibility guards.
2. Implement recurring unit commitments and period-total persistence/charge consumption, including concurrency and retry guards.
3. Connect intent selection, legacy transition, and period-prefilled recording flows.
4. Finish typed diagnostics and shared currency-aware recurring-value calculation.
5. Execute the DB-backed and UI acceptance matrix in `tests.json`.

## Validation

- Run the alga-plan `scripts/validate_plan.py` against this folder.
- All revised checklist items initially remain false: verify existing partial implementation against the complete revised criterion before marking it complete.
- Use isolated development/test data only. No customer-account changes or retrospective invoice generation are part of this plan update.

## Open questions

- No product decision blocks this revision. Resolve concrete schema reuse against the existing recurring-period model without weakening replacement, uniqueness, attribution, or historical-billing requirements.
