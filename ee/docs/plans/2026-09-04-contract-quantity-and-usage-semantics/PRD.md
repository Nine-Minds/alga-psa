# PRD — Contract quantity and usage semantics

- Slug: `contract-quantity-and-usage-semantics`
- Date: 2026-09-04
- Status: Revised design for implementation; not a claim of release readiness
- Supersedes: the earlier XO Usage contracts Design Session packet where requirements differ. This folder is the scope authority; the previous implementation is a partial baseline.

## Summary

Make three customer intentions explicit: bill a standing number of seats every period, bill one reported count for a particular period, or bill additive consumption entries. A contract defines the agreement and prices; its billing method defines where billable quantity comes from. Usage is not an alternative to having a contract.

Recurring seats use Fixed lines with explicit unit pricing. Usage lines stay record-driven, with an explicit measurement mode: period total or additive entries. No absent usage record becomes an implicit recurring baseline.

## Problem and value

Configured quantities have looked invoiceable while billing ignored them without separate usage records. Missing records, explicit zero, and already-invoiced records are conflated. Reports imply zero recurring value for variable usage, and labeling additive entries as snapshots invites duplicate seat charges.

Operators need to predict the next invoice from the agreement they configure, enter period counts without accidentally adding a second charge, and understand both recurring commitments and unreported usage. Existing configurations need a visible transition path without changed historical charges.

## Goals

- Complete the recurring-seat journey from authoring through two consecutive invoices and recurring-value reports.
- Distinguish standing quantity, period count, and additive consumption in authoring, overview, entry, preview, and reporting.
- Make recording missing usage preserve the affected client, service, contract line, and service period.
- Prevent duplicate period totals, replayed writes, double consumption, and misleading missing-usage advice.
- Preserve existing billing semantics until an operator deliberately schedules a transition.

## Non-goals

- Automatic conversion of customer contracts, automatic backfill, retrospective invoices, or direct customer-account changes during development/testing.
- Implicit carry-forward of usage counts, RMM/licensing integrations, general import infrastructure, or estimated usage represented as contractual MRR.
- New mid-period seat true-up policies or retroactive edits to billed quantities. Existing fixed bundle/proration behavior remains available under its existing explicit configuration.
- FX conversion or a new revenue analytics product.

## Users and primary flows

Billing administrators configure agreements; billing operators record usage and prepare invoices; managers review recurring commitments and actual billed revenue.

### Choose billing intent

Show concrete choices, examples, and a calculation summary when adding a service:

| Intent | Quantity source | What happens next period | Minimum/tier scope |
| --- | --- | --- | --- |
| Recurring seats/units | Agreed quantity and unit rate on a Fixed line | Same quantity/rate until an effective change | No usage minimum |
| Report a count for each period | One explicit period total on a Usage line | New report required | Once on the period total |
| Record consumption as it occurs | Dated additive entries on a Usage line | New entries required | Per entry, explicitly labeled |

An existing fixed bundle total remains a distinct pricing basis: changing allocation quantities does not imply a new bundle total. Never present an ignored allocation as a billable seat quantity.

### Recurring seats

Configure 10 Standard units at CA$100, 9 Basic units at CA$85, and 1 Server unit at CA$125. Preview shows CA$1,890 before tax for a full monthly period. Two successive full periods each bill that amount without usage entries; fixed MRR is CA$1,890.

Changing Standard units from 10 to 12 shows CA$2,090 and an effective next unbilled service-period boundary before saving. Prior periods retain their quantity/rate. A zero agreed quantity is zero, never a fallback to one. No date-only UI field shifts across timezones.

### Period count

Open a due period from the contract or missing-usage preview. The form identifies the client, contract, line, service, and period, and displays an existing total if present. Saving 10 and then editing to 12 replaces the total: preview bills 12, never 22. Replaying Save is not a new consumption event.

Counts are whole-period billing quantities, not observations that trigger daily averaging, proration, or last-observation-wins inference. The operator reports the count to bill for that period. The next period starts unreported, with no implicit reuse of the previous count. Zero is an explicit report; absence is unreported.

### Additive consumption

The action says Add consumption, and explains that quantities add together. Two entries of 10 and 12 bill 22 before any per-entry pricing rules. Editing an existing entry changes that entry; adding an entry is explicitly additive. Existing records remain in this mode. The UI must not call them monthly snapshots.

### Legacy transition

Show ignored stored quantities under “Previously configured quantity — not used for billing,” with the saved rate and a concise explanation. Offer “Set up recurring seats” and “Report a period count.” Legacy values may prefill a review form as unconfirmed reference data; opening or saving unrelated settings never creates a charge or a usage record.

## Requirements

### R1 — Explicit agreement semantics

- Persist pricing basis for recurring unit pricing versus existing fixed bundle pricing, and measurement mode for Usage services. Put measurement mode on the service configuration, not on the catalog service globally; the same service can belong to different agreements.
- Existing Usage configurations resolve to additive entries with their current pricing behavior. Existing Fixed lines resolve to their current pricing basis. Do not infer a mode from service name, unit of measure, or legacy quantity.
- Show the chosen behavior and quantity source in wizard, presets/templates, editors, overview, Usage Tracking, and invoice explanation.
- Preserve mixed fixed/hourly/usage agreements and unambiguous attribution. Show contract identity for colliding line names.

### R2 — Recurring unit commitments

- Use a canonical quantity-times-unit-rate calculation for explicitly unit-priced Fixed services. Remove hidden line-total precedence from that pricing basis; keep existing bundle-total precedence in bundle mode.
- Invoice preview, generation, contract overview, and MRR use the same effective quantity/rate and money conventions. Do not require dummy usage records.
- Persist prospective quantity/rate versions or an equivalent immutable period binding. Changes default to the next unbilled service period, display the exact effective date, and do not reprice earlier periods. Reject changes targeting a period already billed or being finalized.
- Full-period seat examples are the acceptance baseline. Retain existing explicitly configured partial-period coverage rules; do not add a new mid-period quantity true-up policy.

### R3 — Period-total replacement and concurrency

- Use one logical total per tenant, client contract assignment, contract line, service configuration, and canonical service-period boundary. The key survives regeneration of recurring-service-period row IDs; a regenerated row must not create a second total.
- Store an explicit period association and measurement semantics. A date-only additive record is not implicitly a period total.
- Create/update totals transactionally with database-enforced uniqueness and optimistic version checking. An identical request-id replay returns the original result; reusing its key with different content is rejected. Conflicting stale edits require reload, not silent overwrite.
- Zero is valid. For period totals, apply the minimum and tiers once to the effective total; with no total, emit unreported and no charge. No guaranteed recurring minimum is implied.
- The generic Add consumption/API path must reject additive writes into a period-total configuration for that period. Do not impose one-record-per-period uniqueness on legitimate additive consumption.
- Finalization consumes the exact total revision shown by preview. Changed/deleted totals or changed applicable configuration invalidate stale previews. Preview itself does not mark records invoiced.
- Invoiced totals cannot be edited/deleted or recreated as another unbilled total. Route post-invoice corrections to the existing invoice adjustment process. Retries, concurrent generation, and period regeneration never double-bill a total.

### R4 — Additive compatibility and pricing

- Preserve existing additive entry amounts, attribution, minimums, tiers, and invoiced state. Label minimum as Minimum per entry and explain that each entry can trigger it; tiers restart per entry under existing behavior.
- An additive retry uses a request id to avoid replaying the same event. Separate deliberate events remain separate even when their date and quantity match.
- New period-total configurations label the same concept Minimum per period report and show the effect of explicit zero. A guaranteed recurring charge belongs to recurring pricing.
- A measurement-mode change is prospective at a displayed unbilled period boundary. Do not mix additive entries and period totals for the same service/assignment/period. Existing entries or invoices in the target period block conversion and explain how to choose a later boundary.

### R5 — Record usage in the correct period

- Contract/preview actions carry client, contract assignment, line, service, and service-period context into the entry form, not only list filters. On multiple missing services, show a contextual chooser; do not guess.
- Open the correct operation: create/edit period total or Add consumption. A selected past billing period stays selected even when opened in a later month. Never silently substitute today.
- Server-side resolution validates all supplied identifiers, assignment eligibility, measurement mode, and period boundaries under the tenant and permissions. Stale/malformed links give an actionable error.
- For additive mode, preselect a valid calendar date in the affected period and visibly show it for confirmation. For period-total mode, show the period itself. Render human-inclusive date ranges while keeping canonical half-open boundaries internally.
- Save returns to/retries the same preview selection so the operator can verify the intended amount.

### R6 — Accurate billing diagnostics

- Return typed service/period states: unreported; explicit zero; billable; already invoiced; attribution unresolved/excluded; calculation error. A zero report raised by a minimum explains both the reported zero and billable quantity.
- Derive reporting status separately from charge eligibility. Invoiced records are excluded from new charges but remain evidence of reporting; never advise creating replacement usage solely because records were already invoiced.
- Mixed invoices show missing services before generation and require an explicit acknowledgement to omit them. Automated generation returns an actionable incomplete-usage result rather than silently finalizing a partial period. Keep omitted obligations available for later billing; do not mark them fulfilled.
- Reuse existing invoice transactions, tax/profile attribution, and charge links. Enforce preview/generation consistency and idempotency at the server boundary.

### R7 — Honest recurring-revenue reporting

- Share a typed recurring-value calculation across contract overview, reports, and summaries. Include effective recurring unit commitments and fixed bundle amounts, normalized by their billing cadence; exclude uncommitted Usage amounts.
- Pure Usage contracts display “Variable usage”; mixed agreements display the fixed amount plus variable usage. Label aggregates Fixed MRR. Historical billed amounts remain separately labeled actual revenue.
- Carry contract currency through rows and return separate aggregates by currency. Never sum CAD/USD minor units and format the result using tenant currency. Show no single grand total without an explicit conversion model, which is out of scope.
- Summary fixed MRR includes active effective commitments, not expired, future, or superseded versions. Scheduled quantity changes show their future value separately.

### R8 — Deliberate transition and history preservation

- Preserve legacy quantities as non-billing reference metadata in normal read paths. No automatic backfill, implicit usage snapshot, or inferred charge.
- A recurring-seat transition requires reviewing quantities, rates, pricing basis, currency, billing cadence, and effective boundary before an explicit save. Close the source configuration prospectively and activate the destination atomically, with no overlap/gap at the boundary.
- A period-total transition requires explicit measurement-mode selection at an eligible boundary, followed by a separate confirmed period report. Historical additive records remain additive.
- Block transitions when outstanding records/charges would be orphaned or duplicated; explain the conflict. Preserve historical invoice and usage attribution.

## Data, API, and permissions

Reuse recurring service-period identities and existing pricing infrastructure where they meet the requirements. Add explicit mode/basis fields and versioned period-total storage where needed; hiding semantics in UI labels is insufficient. A dedicated period-total table or equivalent typed record model must provide the R3 uniqueness, revision, and consumption guarantees.

Expose distinct additive-entry and period-total operations with request identity, expected revision, tenant-validated scope, and period identity. A total revision and its consumption must be locked consistently against invoice finalization. Do not build recurring billing by generating fake usage rows.

All database reads/writes and unique constraints include tenant scope. Use tenant-bound actions, existing billing read/create/update permissions, canonical minor-unit arithmetic, tax/billing-profile resolution, and existing contract-line attribution. Templates must store intended semantics without inventing client-specific period records.

## Rollout and migration

Schema changes preserve legacy semantics. No bulk reinterpretation of historical rows. Missing mode values resolve explicitly to legacy behavior until classified by a safe schema migration; migrations may record equivalent semantics but cannot create billable data.

Keep the existing branch's date, authorization, routing, and deduplication fixes. Verify them against this larger scope. Reconcile the old smoke summary with current evidence before release; passing the earlier tests does not complete this revised plan.

## Risks and implementation decisions

- This revision deliberately adds explicit period-total semantics; it exceeds a copy-only clarification of the original record-driven design.
- Fixed-line rate precedence, zero handling, effective dating, and report reuse need implementation work, not merely links to an existing editor.
- Selecting the concrete schema is an implementation decision; replacement and historical-billing guarantees are fixed requirements. No product decision remains blocking at this stage.

## Acceptance criteria

1. From normal authoring, an operator can choose recurring seats, period count, or additive consumption and correctly predict whether quantities carry forward, replace, or add.
2. The 10/9/1 recurring-seat example bills CA$1,890 before tax in two full monthly periods with no usage rows and reports CA$1,890 fixed MRR. A next-period 10-to-12 change produces CA$2,090 without changing earlier periods.
3. A period count of 10 corrected to 12 bills 12 exactly once. Replays, concurrent edits/generation, and regenerated periods never create 22 units or duplicate charges.
4. Additive entries of 10 and 12 still bill 22; existing per-entry minimum/tier semantics are preserved and visible.
5. No record, explicit zero, a minimum-adjusted zero, unresolved attribution, already-invoiced usage, and calculation errors are distinguishable and direct the appropriate next action.
6. An August missing-usage action opened in September creates/edits August usage for the intended contract line, then returns to that preview.
7. Legacy quantities remain visible as non-billing reference data; a deliberate prospective transition cannot orphan records or double-charge a period.
8. Reports reconcile recurring unit/bundle calculations and cadence normalization, separate currencies, and label variable usage without implying zero contract value.
9. Representative DB-backed and UI tests in `tests.json` pass using isolated data. No source-string tests substitute for behavior, and no customer-account changes occur during validation.

## Active authoring surfaces

Contract Lines → Create Custom must use the same semantic controls as the service configuration editor. Save the selected Usage measurement, minimum and tier prices, or Fixed pricing basis, quantity and unit rate through the custom-line creation action and configuration models. The active Contract Lines editor must load Usage prices for the displayed effective boundary and save them with measurement mode through the transactional transition action, including on previously invoiced contracts. Clearing a required boundary disables Save.

The legacy recurring-seat link remains a manual handoff until the atomic transition in R8 is implemented. Its instructions must explain that a newly created Fixed commitment does not close the source Usage configuration or schedule a conversion.

## Narrow recurring-gap mitigation

Automatic Invoices gap discovery and both operator repair entry points must use the same first eligible obligation start as canonical client-cadence materialization. A monthly assignment beginning September 1 with a September billed or draft-linked ledger boundary starts newly added arrears Fixed/unit and Usage/period-total obligations on October 1. September is not a repairable gap, including through stale direct schedule requests; genuinely missing October periods remain discoverable and repairable without duplicates. No historical obligations, usage, or invoices are backfilled.
