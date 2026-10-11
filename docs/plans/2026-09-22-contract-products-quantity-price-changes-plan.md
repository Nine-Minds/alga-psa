# Recurring contract product quantity and price changes

Status: design ready for review; implementation not started.

Source audit: `ebd63a3a3cfd2d83e0dbe593772b45afcc5522cf`, 2026-09-22. Card: `f6e7254b-0c74-468d-9dd6-822bdf659e15`. Companion: `b97eda7b`, Contract invoices. Line references below describe this checkout, not unverified companion-branch changes.

## Outcome and scope

Operators can schedule quantities and optional per-unit price overrides for recurring products after invoicing starts. Products and explicitly unit-priced Fixed services use the same scheduling, boundary validation, conflict handling and history. Catalog classification does not determine whether recurring counts can be maintained. Bundle allocation quantities, measured Usage, Hourly time and one-time project purchases retain their existing meanings.

For a monthly contract with 20 units at $100, 30 at $50 and 2 at $200, the recurring subtotal is $3,900. Scheduling the first quantity to 23 at the next service-period boundary produces $4,200 for that period and later periods. Earlier billed invoices and delayed billing for earlier unbilled periods retain their applicable quantities. These amounts are before discounts and tax.

## What exists and what is missing

Paths in this table are relative to the repository root; each reference includes its audited line number.

| Area | Code evidence | Finding |
| --- | --- | --- |
| Invoiced contract editing | `packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx:607`, `:615`, `:625`, `:800`, `:807`, `:1664` | Editing, dated reads and saves admit explicitly unit-priced Fixed members or Usage. Ordinary wizard products do not qualify. Opening the editor alone will not fix product persistence or billing. |
| Existing operator language | `packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx:1610` | The date input says “Service pricing and measurement changes effective from”; its help promises earlier settings are preserved. Reuse this interaction and wording consistently, with item-neutral labels where necessary. The audited contract components do not provide a revision-history list. |
| Product authoring | `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ProductsStep.tsx:74`, `:89`, `:170`, `:186`; `packages/billing/src/actions/contractWizardActions.ts:1307` | Wizard quantity clamps to at least one. Blank override means catalog inheritance. Products become Fixed configurations with quantity/custom_rate and `{ base_rate: 0 }`, without explicit unit pricing. |
| Configuration persistence | `packages/billing/src/services/contractLineServiceConfigurationService.ts:160`, `:265`, `:295`, `:321` | Creation defaults pricing_basis to bundle. Only unit configurations route quantity/rate edits into revisions; other Fixed configurations can update live columns. The shared service is the necessary write guard, not just the UI. |
| Revision storage and authorization | `server/migrations/20260904100000_contract_quantity_usage_semantics.cjs:190`; `packages/billing/src/actions/contractLineUnitPricingActions.ts:50` | Existing tenant-scoped revision table has config identity, effective date, nonnegative integer quantity/rate, creator and creation timestamp; unique boundary per configuration. Actions enforce billing read/update permission. Rate is mandatory numeric, so inheritance cannot be expressed as a revision policy. |
| Boundary selection | `packages/billing/src/lib/billing/seatRevisions.ts:39`, `:73`, `:156` | Shared helpers resolve a default, reject billed/locked periods and validate persisted/cadence boundaries. Default is earliest unbilled, which can be historical or in flight; fallback derives a boundary from assignment/cadence. This differs from an unconditional “next month” promise. Invoice-detail protection uses an inclusive end comparison while recurring periods use an exclusive end; boundary semantics require behavioral tests. |
| Revision conflicts and fallback | `packages/billing/src/lib/billing/seatRevisions.ts:105`, `:195`, `:262`; `packages/billing/src/actions/contractLineUnitPricingActions.ts:111` | Latest revision at/before the requested date wins. Same-boundary scheduling updates the existing row without an expected-version check. The helper fallback prefers fixed base_rate, then custom_rate, then default_rate; the action fallback differs. Blindly applying it to products would treat wizard base_rate=0 as a real free price and lose currency inheritance. |
| Service billing precedent | `packages/billing/src/lib/billing/billingEngine.ts:4251`; `packages/billing/src/lib/billing/compute/computeFixedCharges.ts:450` | Fixed service obligations overlay revisions by service+config at covered period start. The unit branch explicitly skips zero quantities. This behavior should be shared, not reimplemented with product-only date rules. |
| Product billing gap | `packages/billing/src/lib/billing/billingEngine.ts:6040`, `:6107`, `:6132`; `packages/billing/src/lib/billing/compute/computeRecurringQuantityCharges.ts:75` | Product/license loading already joins the catalog price as of service-period start in contract currency, but reads live configuration quantities/overrides and never overlays revisions. Compute uses configuration override, service-line override, then catalog price; missing currency price without override is an error. Quantity is rounded/clamped to one at line 96. |
| Tax, coverage and source identity | `packages/billing/src/lib/billing/compute/computeRecurringQuantityCharges.ts:99`, `:139`, `:152` | Existing tax/profile handling and enabled coverage proration must remain. Division by quantity in the proration branch needs a zero guard. Charges already carry config, contract assignment/line, service-period record and covered dates; revision/rate-source identity is missing. |
| Preview and generation | `packages/billing/src/actions/invoiceGeneration.ts:1705`, `:1843`, `:2173`, `:3056` | Preview and actual generation use shared billing calculation; generation runs under a transaction/lock. Extend effective inputs here, rather than calculating a UI-only total. Existing stale-preview handling for Usage is a precedent, not proof of product protection. |
| Discounts | `packages/billing/src/lib/billing/billingEngine.ts:1974`, `:2026`; `packages/billing/src/lib/billing/compute/computeDiscountsAndAdjustments.ts:121` | Shared compute selects applicable discounts, calculates percentage amounts from totalAmount or fixed amounts, then adds adjustments. Product changes must feed the recomputed eligible amounts into this pipeline. Allocation, invoice display and adjustment semantics belong with the companion card. |
| Recurring value | `packages/billing/src/actions/contractActions.ts:1202`, `:1264`; `shared/billingClients/contractMonthlyValue.ts:85`, `:176`, `:238`; `packages/billing/src/lib/billing/pricing/loadFixedLineRateInputs.ts:209` | Overview and monthly valuation have unit-only revision readers, with duplicated rate/quantity logic. Shared valuation recognizes pricing_basis=unit, so marking every legacy product unit immediately could change old valuation and rate precedence. The fixed-rate loader also reads revisions independently. Audit and consolidate consumers before changing representation. |

## Scheduling and operator flow

1. From client contract detail, expand a recurring contract line and choose Edit/Schedule change. Each eligible recurring product and unit-priced service exposes Quantity, Unit price, pricing source and the effective service period, including after invoices exist. Server-provided capability metadata drives both the UI and mutation validation. Product classification remains useful for presentation and charge routing, but is not a prohibition on scheduling.
2. Default to the next canonical service-period start after the current period for an active contract; a future assignment can start at its first period. Display actual covered dates and cadence owner. Do not silently choose an older unbilled period merely because it sorts first. Apply this default consistently to the shared service workflow. Permit explicit selection of an older unbilled boundary only when the shared billed/locked guards admit it, with a warning that pending billing from that date onward changes. This is a prospective pricing change, never an edit to issued invoices.
3. Load the effective quantity and price policy for the selected period. Changing the date reloads those settings; warn before discarding unsaved input and ignore stale asynchronous responses. Show current and scheduled quantity, effective date, currency, price source, subtotal delta and estimated next invoice impact. Call the same billing preview path for discounts/taxes; if preview cannot resolve, show its error and no invented total.
4. Price controls distinguish “Use catalog price” and “Override unit price.” Quantity-only edits preserve the existing policy. An explicit zero override is a free unit price, not an empty input. Resetting to catalog inheritance is a dated change. Services retain their existing explicit price behavior; the shared API supports rate policies without forcing inheritance onto bundle services.
5. Quantity accepts whole numbers >=0. Zero is “Stop recurring billing from [period]”: retain configuration and history, charge no units from that date, allow later resumption by another revision. Do not equate zero with removing the item. Explain that other contract items and applicable fixed discounts can still affect the invoice. Removal of a historically priced item cannot bypass this flow or delete its revisions.
6. Add a shared history panel for products and unit-priced services: baseline, effective dates, quantity, rate policy, resolved price/currency where available, actor, scheduled/current state and protected billed periods. For inherited prices, label catalog inheritance rather than claiming a permanent rate; billed invoice amounts remain the authoritative snapshot. Editing a pending boundary requires its version token. Billed/locked entries are read-only. Preserve an audit record of superseded pending edits.
7. Use labeled controls with stable unique IDs, keyboard navigation, visible focus, linked error text and announced save/conflict results. A successful save keeps focus near the changed item and displays its effective period. Use the same terms and history component for both catalog kinds.

## Shared data and mutation design

Extend `contract_line_unit_pricing_revisions` and the existing seat-revision service; do not introduce a product revision table or a separate date validator. Extract a neutral recurring-unit capability and effective-pricing contract into a shared billing layer that both `packages/billing` and `shared/billingClients` can import without a dependency cycle.

The effective result must include tenant, contract assignment, line, service and config identity; service-period identity and start/end; effective revision identity/version; quantity; unit rate in minor currency units; currency; rate source and catalog-price identity/effective date where applicable. Separate DB loading from deterministic selection so the same selection rules serve billing, editing and valuation.

Extend revision storage with an explicit price policy (`override` or `catalog`), nullable override amount for catalog mode, and a version used for compare-and-set updates. Existing numeric revisions retain override behavior. Preserve nonnegative integer constraints and tenant-inclusive uniqueness/Citus distribution. Record superseded pending revisions in an audit/history structure linked to the canonical revision rather than losing who changed what. Baseline legacy product pricing remains in its original columns; activation begins at its first scheduled revision, not at migration time. A revision stores the full effective quantity and policy, not a delta applied repeatedly.

When scheduling the first product revision, derive the prior policy from actual product precedence: configuration override, then legacy service-line override, else catalog inheritance. Never use the wizard's fixed base_rate=0 as the product override. Freeze the baseline configuration against future direct quantity/rate writes once a scheduled history exists. New recurring products can carry explicit recurring-unit capability at creation, but must remain on exactly one charge route: existing product/license charge computation, not both that and Fixed service computation.

Every mutation uses the shared tenant billing lock, verifies tenant/config/line membership and billing:update permission, revalidates assignment and canonical boundary, and checks billed/locked history inside the transaction. Return actionable errors for invalid calendar dates, unsupported cadence without materialized periods, dates outside assignment, mid-period dates, negative/fractional quantity, invalid price, protected periods and stale versions. A stale edit says to reload the period and review the newer values. Creating two revisions at the same boundary cannot silently replace the first. Explicit pending revision updates use compare-and-set plus history recording. A whole line save must be atomic or clearly identify partial failure; prefer a single transaction for its item changes.

Use half-open service periods internally, preserving adapters for legacy invoice detail date conventions. Do not loosen billed-date protection based on an assumed end-date convention. Test a boundary exactly at the billed period end before changing the existing guard. Configuration deletion, wizard/draft updates and other direct writers must respect the same history guard.

## Effective billing, zero and compatibility

Load and resolve quantity and rate against the covered service-period start, never invoice issue date, current time or a shared mutable configuration. Latest applicable revision wins; no applicable revision follows the unchanged legacy product path. This preserves older unbilled periods, existing pricing precedence and existing contracts even if a future change has been scheduled.

For revised products, allow zero to reach the computation as zero and omit its monetary charge before tax or proration division, matching the service unit branch. Keep a zero/stopped explanation and persisted pricing-source record so billing completion and previews can distinguish “nothing due” from “missing data.” An all-zero period must reach a deliberate no-charge outcome and not remain an endlessly retryable period. A missing catalog price should block a positive billable quantity; a stopped item should not need a price to create a zero monetary outcome. Resumption must validate its currency price.

Do not mass-rewrite historical quantities, price modes, catalog overrides or invoices. In particular, legacy zero/null/invalid product quantities currently coerced by the old calculation keep that legacy behavior before the first explicit revision; expose it clearly when an operator schedules the correction. New and revised quantities use strict validation. This compatibility boundary reconciles zero correctness with the requirement not to reprice untouched contracts.

Keep catalog inheritance dynamic using the existing currency- and period-effective `service_prices` join. A quantity change does not pin today's catalog rate. Explicit overrides, including zero, win and are in contract currency. Currency changes with scheduled/billed history need a guarded contract operation; do not reinterpret stored minor units in another currency. Reuse tax region, exemptions, profile and rounding rules after resolving effective inputs. Preserve current coverage proration for partial contract coverage; scheduling a quantity change does not enable it.

Feed identical effective inputs and provenance through preview and invoice generation. Include revision version and catalog-price source in preview consistency validation, alongside selected periods and discount inputs. If a source changes after preview, require a new preview rather than charging a different amount silently. Persist source and resolved amounts with invoice charge details; repeated generation must use existing period/charge consumption and locking, not apply a revision again as an adjustment.

Extend overview and shared monthly valuation to use the same effective quantity/rate policy. Current MRR uses the current applicable service period; future scheduled value is separately labeled. Preserve cadence normalization and currency separation. MRR remains its existing gross recurring-value metric unless the companion design explicitly changes it; invoice discounts/tax are not silently relabeled as MRR. Historical displays use their requested as-of period, not today's revision.

## Companion invoice contract and proration policy

Baseline policy: changes take effect only at canonical service-period boundaries. There is no mid-period quantity/rate edit, implicit true-up, backdated credit or automatic adjustment generated merely by saving a revision. For 20 to 23 at $100 next month, this period changes by $0 and the next full recurring subtotal increases by $300. A decrease reverses that next-period delta; stopping the $100 item reduces the example subtotal to $1,900. Show those impacts explicitly.

Existing enabled coverage proration remains supported for partial contract coverage. It must operate on the effective period quantity/rate and expose the coverage dates and ratio in preview. It is distinct from a mid-period quantity change. The companion must not infer an intra-period change or credit from a difference between live configuration values and an earlier invoice.

Agree the following proposed handoff with `b97eda7b` before integrating either implementation:

- Source identity: tenant, client contract/assignment, contract line, service, config, recurring service-period record, covered start/end, billing timing and currency.
- Pricing provenance: revision ID/version/effective boundary, baseline or revision source, quantity, unprorated unit price, inherited catalog-price ID/date or explicit override, coverage ratio, resolved pre-discount subtotal and tax/profile context.
- If an explicitly supported adjustment policy is later enabled: stable adjustment identity, original invoice/charge link, original and replacement source versions, delta coverage window, signed quantity/amount delta, reason and policy identifier. This card emits no such charge under the baseline policy.
- Invoice ownership: companion allocates applicable fixed/percentage discounts and any authorized adjustments once, presents separate understandable lines, computes the correct taxable base, and persists original-source links. This card supplies resolved effective facts and consumes that same pipeline in preview.
- Idempotency: retries identify the same obligation/period/source version; a changed revision invalidates a stale preview rather than becoming a second invoice line. Discount identity and allocation keys must not duplicate a fixed discount per product or per retry.

For a whole-contract 10% discount, the example's $3,900/$4,200 gross subtotals become $3,510/$3,780 before tax. For a $100 fixed discount they become $3,800/$4,100. Mixed discount scopes, stacking, caps and credit tax treatment must follow the companion's explicit rules; this card does not invent them. Any future mid-period policy requires a separate approved design specifying day-count/rounding, billed versus unbilled handling, discount reversal and credit tax behavior, plus an operator-visible invoice preview before acceptance.

## Implementation sequence

1. Add characterization fixtures for existing wizard product pricing, currency inheritance, legacy zero coercion and unit-service revisions. Confirm all writers/readers and actual invoice date conventions. Establish companion source contract and discount ownership.
2. Add backward-compatible revision price policy, concurrency version and pending-edit history. Introduce shared capability/effective-selection types. Test migrations against PostgreSQL and the repository's Citus constraint rules.
3. Extend shared scheduling/read actions and configuration service. Enforce boundaries, permissions, version conflicts, baseline preservation and deletion guards. Route recurring product authoring through the same capability without repricing existing rows.
4. Integrate the effective resolver into product/license obligations and consolidate service readers. Preserve existing charge routing, currency resolution, tax and coverage calculations. Handle zero before division; persist zero-period outcomes and effective source provenance.
5. Extend shared preview/generation consistency and companion invoice metadata. Update recurring valuation and overview readers. Avoid circular dependencies by locating shared selection logic below UI/actions and billing adapters.
6. Add the accessible scheduler and common history panel, price-source controls, clear stop/resume behavior and effective invoice preview. Update new-product quantity validation deliberately, with compatibility tests for existing drafts/contracts.
7. Run behavioral, DB integration and actual UI smoke validation. Record evidence and remaining limitations before implementation review. No source-string or import-presence assertions count as coverage.

## Validation and evidence required

| Scenario | Behavioral acceptance |
| --- | --- |
| Main example | Bill 20/30/2 at $100/$50/$200; schedule 23 next month; preview and generate $3,900 then $4,200 before discounts/tax. Reopen the old invoice and verify quantities/amounts unchanged. Repeat generation and confirm no duplicate period, charges or discounts. |
| Delayed periods and ordering | Leave an older period unbilled, schedule a future revision, then bill the older period. It still uses 20. Test several future revisions, dates exactly on boundaries, arrears/advance billing, client-owned and contract-owned cadence, and month-end/leap-day anchors. |
| Decrease, stop and resume | Independently schedule 18 ($3,700 subtotal), zero ($1,900) and later resume. Zero remains zero, no divide-by-zero/NaN, no phantom unit, no deleted history. Test a contract with every item stopped and verify a stable no-charge period outcome. |
| Price policy | Override to $110 at 23 units ($4,430 gross subtotal), explicit zero rate, quantity-only inheritance, reset override to catalog, dated catalog price change and two contract currencies. Missing required currency price gives an actionable error; no untagged currency fallback. |
| Discounts and tax | Separate 10% and $100 fixed discount examples above; multiple items, scoped/expired discounts and repeated generation. Assert actual persisted invoice subtotal, discount allocation, tax and total. Include exempt/taxable profiles and coverage proration. Validate companion adjustment sources with fixtures without enabling mid-period edits. |
| Rejected changes | Invalid calendar date, negative/fractional quantity, invalid price, mid-period/outside-assignment date, billed/locked periods, unauthorized user and cross-tenant/config input all leave DB state unchanged. Exactly-at-end protection matches canonical date conventions. |
| Concurrency | Two editors at the same boundary: second stale write rejected, history retained. Race scheduling against generation: lock protects invoice source. Change revision or catalog source after preview: actual generation requires re-preview. |
| Compatibility and parity | Untouched legacy product pricing remains identical, including historical zero behavior and custom-rate precedence. Legacy bundles, unit services, Usage and Hourly remain unchanged except shared explicit conflict/default policy improvements. Product/license routing bills once; shared overview/MRR matches effective gross recurring amounts at current and future dates. |
| Actual UI smoke | In a running app, invoice a contract, reopen its line, schedule increase/decrease/stop/rate change using keyboard as well as pointer, inspect history and pricing source, and verify preview plus generated customer invoice. Exercise a rejected billed date and stale edit in two tabs. Capture screenshots and persisted revision/invoice IDs with amounts and covered dates. |

Use existing `packages/billing/src/lib/billing/compute/compute.test.ts` recurring quantity cases as a starting point, extend shared resolver tests, and add migrated-schema DB integration coverage near `server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts`. Confirm test path and fixture conventions before implementation. UI evidence must record the actual tested build and scenario; this design session does not claim any implementation tests or UI smoke have run.

## Approved amendment (2026-09-27): opt-in mid-period quantity true-up

Boundary-only scheduling remains the default and is unchanged: the shared
earliest-unbilled boundary selection, explicit boundary edits and the billed /
locked guards continue to apply. An operator may explicitly opt in — per change,
in the scheduler UI — to a **quantity-only** change effective inside an eligible
unbilled service period. The opt-in records the permanent change once and emits
one automatic prorated charge or credit for the partial period.

- **Storage and cancellation.** `contract_line_unit_pricing_revisions` gains a
  nullable `mid_period_effective_date`. On the boundary path it is null; on the
  mid-period path the canonical `effective_period_start` remains the next
  canonical boundary (the standing quantity begins there) and
  `mid_period_effective_date` records the true date. The compare-and-set,
  version, tenant isolation and append-only superseded-edit history are
  preserved; the superseded edit records the mid-period date it replaced. Saving
  boundary-only at the same canonical boundary cancels the pending true-up, as
  does editing to a zero delta or cancelling the revision.
- **Adjustment ownership and storage.** This card owns the permanent change and
  its automatic true-up. The true-up is held in a new durable ledger,
  `contract_recurring_unit_adjustments` (tenant-scoped, registered in
  `tenantTableMetadata`), keyed one-per-canonical-revision so editing a pending
  version reconciles in place. It carries the companion provenance contract:
  `adjustment_source_kind = 'contract_change'`, revision id plus version as
  source identity, `adjustment_period_start/end`, and `adjustment_reason`.
- **Amount.** `quantity delta × effective unit rate × covered days / full-period
  days`, rounded once with the engine's existing coverage-proration convention
  (`Math.ceil`). Increases are charges, decreases are credits. The September 16
  change from 10 to 13 seats at $100/month is `[September 16, October 1)`,
  `3 × $100 × 15/30 = $150`.
- **Date conventions.** Detail rows keep the legacy inclusive end;
  canonical periods and companion adjustment periods are half-open. An inclusive
  end maps to the following date as the exclusive end before any day count.
- **Rate selection.** A mid-period change may not change the unit price: the
  effective rate for the true-up is the rate in force for the affected period
  (override, or the currency/period catalog price for catalog policy). No new
  mid-period price policy is introduced; a price change is scheduled at a
  boundary.
- **Invoice eligibility and lifecycle.** The true-up is materialized on the next
  eligible editable draft for the same client, contract, currency and line, and
  never on a finalized, paid or exported invoice. If the affected period's
  invoice finalized first, the pending adjustment carries forward with its
  original period. Regeneration and retries reconcile the source-linked
  `invoice_charges` row (unique on tenant, invoice, source kind and source id)
  rather than duplicating it.
- **Discounts and tax.** The resolved true-up joins the invoice charges before
  the shared discount and tax pipeline, so applicable fixed and percentage
  discounts and tax apply exactly once; the amount is never prorated again. The
  companion owns the invoice-side manual partial-period calculator, its link to
  the contract scheduler and its overlap warning; this card emits no invoice-side
  contract quantity writer.

Implementation notes (2026-09-27, round 2): the automatic evaluation of
discounts now runs through the shared `evaluateContractInvoiceAdjustments`
(added to this branch), with negative credit lines excluded from the positive
base; the true-up lifecycle is owned by a transactional reconciliation service
that claims only the earliest eligible editable draft, enforces
client/assignment/currency/included-line eligibility, refreshes edited versions,
removes cancelled settlements, releases deleted drafts, and never resets a
finalized settlement; `bindRecurringPricingSources` binds the true-up's
identity/version/date/amount/rate into the reviewed source set for
preview-to-generation stale protection; and the proration rounding/day-count
arithmetic is a single shared primitive used by both the recurring compute and
the true-up.

The baseline policy description below is retained for the record; where it says
no mid-period true-up is emitted, the opt-in amendment above supersedes it.

## Deliberate exclusions

No implementation or PR accompanies this plan. No bulk conversion of legacy products, rewriting issued invoices, retroactive catalog repricing, product-only revision engine, usage/time semantics changes, one-time/project-product scheduling, generalized subscription cancellation, fractional recurring counts, currency conversion or automatic mid-period true-ups. No new discount rules or tax policy. An existing bundle allocation is not made unit-priced merely because its catalog classification changes.

## Open questions and risks

- **Boundary default:** the audited service helper chooses earliest unbilled. The proposed next-period default changes that UX for services too. Confirm with the design owner; retain explicit eligible historical-boundary selection and tests rather than silently repricing older periods.
- **Companion integration:** `b97eda7b` must confirm source schema, stale-preview fingerprint, adjustment identity, discount allocation/stacking and tax ownership. This audit has not reviewed its implementation branch. Mid-period edits remain unsupported until an explicit joint policy exists.
- **Legacy and mixed data:** products may exist outside wizard-created Fixed lines, or coexist with bundle members, licenses and shared contract assignments. Inventory real supported shapes before defining eligibility; unsupported shapes need actionable feedback. Revision scope is currently contract-line/config, so a contract assigned to multiple clients can affect multiple assignments; disclose affected assignments and validate all protected periods.
- **History and storage:** choose a Citus-safe audit representation for pending edits and confirm retention/deletion rules. Do not claim created_at alone captures overwritten history. Changes to mandatory numeric rate affect every revision reader and require a coordinated migration/deployment.
- **Zero-period consumption:** confirm how existing generation records an all-zero obligation and whether the companion displays a zero informational line or omits it. Either presentation must preserve history and prevent repeated pending generation. Confirm fixed-discount behavior when eligible subtotal is zero.
- **MRR compatibility:** current valuation is unit/bundle oriented and may already understate legacy products. This plan preserves untouched legacy values; whether to correct historical legacy MRR independently needs a separate decision, not an incidental migration change.
- **Date/currency source integrity:** prove inclusive legacy invoice-detail ends versus exclusive recurring ends and catalog-price effective identity. Retroactive catalog edits and contract currency changes must not mutate protected invoice outcomes.

### Settlement repair (2026-09-27)

Preview and persistence use the same contract-discount selection over covered
service periods. A carry-forward adjustment retains its original coverage;
invoice-header dates do not replace those dates. Source-linked automatic
percentage discounts bypass the manual percentage recalculator before tax.

The settlement target is an invoice identity, including when two drafts share a
window. Client, assignment, currency, represented line and affected-period
eligibility apply to every ledger row. Only a successfully materialized charge
contributes to invoice totals. Removing a line or changing the currency of an
editable owner releases its settlement for a later eligible draft; finalized
settlements remain immutable.
