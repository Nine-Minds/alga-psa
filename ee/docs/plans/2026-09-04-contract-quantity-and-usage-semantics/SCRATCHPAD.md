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

## Implementation round status (2026-09-04, Draft Implementation)

Durable record of what the Draft Implementation round changed and verified. Features/tests flags in `features.json`/`tests.json` are the authoritative per-criterion truth; this section records where the evidence lives so a reviewer does not re-derive it.

### Done and DB-verified (isolated fixtures; no customer data touched)

- Migration `server/migrations/20260904100000_contract_quantity_usage_semantics.cjs`: explicit `measurement_mode` (usage config, legacy `additive` default) and `pricing_basis` (fixed config, legacy NULL = bundle); new `usage_period_totals` and `contract_line_unit_pricing_revisions` stores with DB uniqueness and non-billable rollout.
- Period totals: `packages/billing/src/actions/usagePeriodTotalActions.ts` (create/replace/delete/get with request-id replay, logical-key replacement, revision/stale guards, billed-immutability); engine consumption in `billingEngine.ts::loadUsageBasedObligation` (additive vs period-total split, typed statuses) + `computeUsageBasedCharges` (period-total charge identity) + `invoiceService.ts` single-consumption lock and draft-void release.
- Recurring seats: `pricing_basis='unit'` Fixed lines bill quantity × unit rate with no `||1` fallback and no bundle line-total precedence (`computeFixedCharges` unit branch, `billingEngine` loaders carry `pricing_basis` through the domain facts layer); `contractLineUnitPricingActions.ts` schedules effective-boundary revisions honored by the engine; `contract_line_unit_pricing_revisions` rows keep earlier billed periods untouched.
- Mode/basis read path and guard actions: `contractLineSemanticsActions.ts` (mode conversion blocked while unbilled entries/recorded totals exist), additive-write rejection into period-total configs in `usageActions.ts`.
- Diagnostics: usage statuses now distinguish `missing_usage`/`unreported`, `explicit_zero`, `minimum_raised_zero`, `already_invoiced` (with evidence fields) and are surfaced by the invoice preview; `AutomaticInvoices.tsx` renders actionable vs already-recorded evidence separately so already-invoiced periods never prompt duplicate recording.
- Reference read path: `getContractOverview` returns `previouslyConfiguredQuantity` for Usage services and `ContractOverview.tsx` renders it as non-billing reference data.
- DB-backed behavioral suite: `server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` (17 tests) — seat journey 189000 → scheduled 209000, period-total replacement/replay/concurrency/regeneration/min-once/explicit-zero/unreported/billed-immutability, additive preservation, wrong-mode rejection.

### Known gaps this round (leave related flags false; see draftSummary)

- No authoring UI yet for choosing "recurring seats / period count / additive" intents (F001/F003), no period-total/period-prefilled entry form in Usage Tracking (F012–F014), no wizard/template/preset editors for the new basis/mode.
- Stale-preview enforcement at generation (approval shows revision X, generation consumes exactly X) is not implemented; generation recomputes from current DB state exactly as additive usage does today.
- Mixed-invoice omission acknowledgement and automated-run incomplete-usage reporting (F016) are not implemented.
- Per-currency recurring-revenue reporting (F018–F020) and the legacy-transition authoring journeys (F021–F023) are not implemented.
- Additive request-id retry protection is not implemented (additive entries have no request identity).
- No live browser smoke was run on port 3748 this round; verification is DB-backed + jsdom only.

### Reviewer first-stop

`billingEngine.ts` usage/fixed loaders and the domain facts threading in `calculateContractCharge.ts`; the period-total consumption lock in `invoiceService.ts::linkAndMarkSourceBillingRecord` and its draft-void release in `invoiceModification.ts`; `usagePeriodTotalActions.ts` replay/revision semantics.
