# Pass 0 Appendix — Inventory, Parity, and Compatibility Boundaries

This appendix turns the PRD's pass-0 goals into implementation-grade artifacts. It is intentionally source-backed: the file inventory below is paired with `pass-0-source-inventory.json`, and a docs contract test keeps the appendix aligned with live code references.

## Architecture Flow

Recurring billing normalization in this plan follows one authoritative sequence:

1. cadence owner determines the boundary generator
2. the boundary generator emits canonical service periods
3. assignment activity windows intersect those service periods
4. due-position rules map service periods onto invoice windows
5. invoice selection chooses due recurring work for a billing run
6. persisted invoice detail rows carry the canonical service-period metadata downstream

Anything that still derives timing from invoice headers, `billing_cycle_alignment`, or charge-family-specific proration is inventory debt or cleanup work.

## System-Surface Matrix

| Surface | Key files / seams | Why it is in scope | Pass-0 requirement |
| --- | --- | --- | --- |
| Runtime billing | `packages/billing/src/lib/billing/billingEngine.ts`, `shared/billingClients/createBillingCycles.ts`, `packages/billing/src/lib/billing/createBillingCycles.ts` | Current runtime still mixes client cycles, assignment dates, `billing_timing`, `enable_proration`, and `billing_cycle_alignment`. | Inventory live timing controls and define the parity target before refactors begin. |
| Invoice generation and persistence | `packages/billing/src/actions/invoiceGeneration.ts`, `packages/billing/src/services/invoiceService.ts` | Recurring timing leaks into invoice detail persistence, duplicate prevention, and billed-through behavior. | Document the header-vs-detail timing split and the future cut line. |
| Credits / prepayment / negative invoices | `packages/billing/src/actions/creditActions.ts`, `packages/billing/src/actions/invoiceModification.ts`, `server/src/test/infrastructure/billing/credits/*`, `server/src/test/infrastructure/billing/invoices/prepaymentInvoice.test.ts`, `server/src/test/infrastructure/billing/invoices/negativeInvoiceCredit.test.ts` | These flows already depend on recurring timing metadata and are likely to regress if service periods move. | Capture the existing consumers before any timing model changes. |
| Pricing / discounts / PO / tax | `server/src/test/infrastructure/billing/pricingSchedules/pricingScheduleRateOverrides.test.ts`, `packages/billing/src/services/purchaseOrderService.ts`, `packages/billing/src/services/accountingExportInvoiceSelector.ts` | These features evaluate dates or grouping constraints that depend on recurring timing semantics. | Add them to the parity matrix instead of treating them as follow-on surprises. |
| Data model / API / repositories | `server/src/lib/repositories/contractLineRepository.ts`, `server/src/lib/api/services/ContractLineService.ts`, `server/src/lib/api/schemas/contractLineSchemas.ts`, `packages/billing/src/repositories/contractLineRepository.ts` | `billing_cycle_alignment`, `billing_timing`, and `enable_proration` are still propagated by write paths and read models. | Inventory live storage and propagation points before introducing `cadence_owner`. |
| UI authoring and settings | `packages/billing/src/components/billing-dashboard/ContractLineDialog.tsx`, `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`, `packages/billing/src/components/billing-dashboard/contracts/QuickStartGuide.tsx`, `packages/billing/src/actions/billingCycleAnchorActions.ts` | Current UI teaches proration-centric workarounds and assumes client cadence is universal. | Capture every authoring surface that must be updated with explicit cadence language. |
| Portal / reporting / downstream readers | `packages/client-portal/src/actions/account.ts`, `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`, `packages/billing/src/actions/contractReportActions.ts` | These readers mostly flatten contract or invoice-header timing today and will need an explicit post-cutover policy. | Document them now so parity is checked at the reader contract, not only in the engine. |
| Accounting exports | `packages/billing/src/services/accountingExportInvoiceSelector.ts`, `packages/billing/src/repositories/accountingExportRepository.ts`, `packages/billing/src/adapters/accounting/xeroAdapter.ts`, `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts` | Export adapters already persist or flatten service-period fields and are sensitive to shape drift. | Define their current data contract and include them in parity checks. |
| Migration / cleanup | `server/migrations/20251025120000_add_billing_timing_metadata.cjs`, `server/migrations/20251028120000_consolidate_contract_line_rates.cjs` | Historical timing fields and compatibility migrations already exist. | Treat migration state as part of the live system, not a background assumption. |

## Live Timing-Control Inventory

Source-backed file lists live in `pass-0-source-inventory.json`.

### Current controls that materially affect recurring timing

| Control | Current role | Evidence anchors |
| --- | --- | --- |
| `resolveServicePeriod` | Billing-engine helper that still decides charge timing directly for recurring execution. | `packages/billing/src/lib/billing/billingEngine.ts`, `server/src/test/unit/billing/billingEngine.timing.test.ts` |
| `billing_cycle_alignment` | Legacy timing selector persisted across migrations, models, APIs, actions, and UI. | See `billingCycleAlignmentRefs` in `pass-0-source-inventory.json`. |
| `billing_timing` | Advance-vs-arrears switch that currently changes which period is billed and how detail metadata is written. | `packages/billing/src/lib/billing/billingEngine.ts`, `packages/billing/src/services/invoiceService.ts`, `server/src/test/integration/billingInvoiceTiming.integration.test.ts`, contract line schemas and UI actions. |
| `enable_proration` | Current user-facing workaround for partial-period coverage; still propagated through write paths and tests. | `packages/billing/src/lib/billing/billingEngine.ts`, `server/src/lib/api/services/ContractLineService.ts`, contract wizard/dialog components, infrastructure billing tests. |
| Client billing frequency and generated client cycles | Current recurring clock for existing tenants and the main parity baseline. | `shared/billingClients/createBillingCycles.ts`, `packages/billing/src/lib/billing/createBillingCycles.ts`, `packages/billing/src/actions/invoiceGeneration.ts`, `packages/billing/src/actions/billingCycleActions.ts`. |
| Client anchor settings | Monthly / quarterly / semi-annual / annual anchor behavior that must be preserved under client cadence. | `shared/billingClients/billingCycleAnchors.ts`, `packages/billing/src/lib/billing/billingCycleAnchors.ts`, `packages/billing/src/actions/billingCycleAnchorActions.ts`, `server/src/test/infrastructure/billing/invoices/clientBillingCycleAnchors.test.ts`. |
| Assignment start / end dates | Current overlay used to trim or skip recurring work and to explain portal contract periods. | `shared/billingClients/contractLines.ts`, `packages/client-portal/src/actions/account.ts`, `packages/billing/src/lib/billing/billingEngine.ts`. |

## Persisted Date and Period Fields

These are the persisted fields that currently participate in recurring timing or billed-through semantics.

| Persisted field(s) | Current table / surface | Current purpose | Evidence |
| --- | --- | --- | --- |
| `client_billing_cycles.start_date`, `client_billing_cycles.end_date`, `billing_cycle_id` | Client billing cycle storage and generation actions | Primary recurring invoice window for current client-cadence execution. | `shared/billingClients/createBillingCycles.ts`, `packages/billing/src/actions/invoiceGeneration.ts`, `packages/billing/src/actions/billingCycleActions.ts` |
| `invoices.billing_period_start`, `invoices.billing_period_end` | Invoice headers | Current grouping metadata; some readers still derive recurring meaning from it. | `packages/billing/src/actions/invoiceGeneration.ts`, `server/src/lib/api/services/InvoiceService.ts`, `packages/billing/src/services/accountingExportInvoiceSelector.ts` |
| `invoice_item_details.service_period_start`, `invoice_item_details.service_period_end`, `invoice_item_details.billing_timing` | Invoice detail persistence | Current detail-level recurring timing record for advance/arrears and export consumers. | `packages/billing/src/services/invoiceService.ts`, `server/migrations/20251025120000_add_billing_timing_metadata.cjs`, `server/src/test/integration/billingInvoiceTiming.integration.test.ts` |
| `client_contract_lines.start_date`, `client_contract_lines.end_date` | Assignment / recurring obligation activity window | Current overlay for partial-period starts, terminations, and portal display. | `shared/billingClients/contractLines.ts`, `packages/client-portal/src/actions/account.ts`, `packages/billing/src/lib/billing/billingEngine.ts` |
| Accounting export batch line `service_period_start`, `service_period_end` | Export read model | Flattened downstream representation used by adapters and export history readers. | `packages/billing/src/repositories/accountingExportRepository.ts`, `packages/billing/src/adapters/accounting/xeroAdapter.ts`, `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts` |

## Service-Period Consumer Inventory

### Detail-level consumers already reading canonical-like period fields

- Invoice detail persistence and hydration:
  - `packages/billing/src/services/invoiceService.ts`
  - `server/src/interfaces/billing.interfaces.ts`
- Accounting exports:
  - `packages/billing/src/services/accountingExportInvoiceSelector.ts`
  - `packages/billing/src/repositories/accountingExportRepository.ts`
  - `packages/billing/src/adapters/accounting/xeroAdapter.ts`
  - `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`
- Accounting integration tests:
  - `server/src/test/integration/accounting/invoiceSelection.integration.test.ts`
  - `server/src/test/integration/accounting/batchLifecycle.integration.test.ts`
  - `server/src/test/integration/accounting/xeroLiveExport.integration.test.ts`

### Dependent flows that already rely on recurring timing, even if they do not always read detail fields directly

- Credits and reconciliation:
  - `packages/billing/src/actions/creditActions.ts`
  - `packages/billing/src/actions/creditReconciliationActions.ts`
  - `server/src/test/infrastructure/billing/credits/*`
- Prepayment and negative invoices:
  - `packages/billing/src/actions/invoiceModification.ts`
  - `packages/billing/src/actions/manualInvoiceActions.ts`
  - `server/src/test/infrastructure/billing/invoices/prepaymentInvoice.test.ts`
  - `server/src/test/infrastructure/billing/invoices/negativeInvoiceCredit.test.ts`

### Downstream readers that still flatten or infer timing

- Client portal:
  - `packages/client-portal/src/actions/account.ts`
  - `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`
  - `packages/client-portal/src/components/account/BillingSection.tsx`
  - These currently derive cycle and contract periods from client billing cycles or assignment dates, not authoritative recurring detail rows.
- Reporting:
  - `packages/billing/src/actions/contractReportActions.ts`
  - These reports currently summarize invoice dates, contract dates, or assignment dates. They are downstream consumers because service-period-first billing can change which date basis is authoritative.

## Compatibility Boundaries for Explicitly Out-of-Scope Flows

| Flow | Scope status in this PRD | Compatibility boundary during v1 recurring work |
| --- | --- | --- |
| Time entry billing | Out of first hard cut | May continue using event-driven usage dates and existing billed-through assumptions; recurring refactors must not silently change it. |
| Usage-record billing | Out of first hard cut | Usage event windows remain their own truth source until a separate follow-on plan explicitly unifies them. |
| Materials / non-recurring charges | Out of first hard cut | Manual or one-off financial artifacts stay intentionally outside the canonical recurring schedule. |
| Manual-only invoice flows | Out of first hard cut for canonical schedule generation | Manual invoices must coexist with recurring detail periods but must not begin generating service periods on their own during v1. |
| Bucket usage metrics outside recurring bucket contract lines | Explicit follow-on / partial scope only | Bucket readers that rely on usage period tables stay on current semantics unless the line is part of recurring contract-backed billing in scope for this plan. |

### Explicit v1 exclusions by behavior

- Time entry billing stays event-driven in v1:
  - selection continues to use `time_entries.start_time` / `time_entries.end_time` against the invoice window
  - no persisted recurring service-period ledger is generated for time entries during this cut
  - billed-through, duplicate prevention, and credit behavior for time entry billing must remain on the current invoice-window/date-query model until a separate follow-on plan says otherwise
- Usage-record billing stays event-driven in v1:
  - selection continues to use usage-event dates and current end-exclusive overlap rules
  - no canonical recurring service periods are generated for ad hoc usage records during this cut
  - recurring service-period-first work must not silently change how usage events are grouped, billed-through, or credited outside explicit recurring bucket overlays already in scope
- Bucket behavior is split explicitly:
  - in scope now: recurring bucket contract lines where allowance periods, rollover, overage charging, and tax-date evaluation already depend on recurring timing semantics
  - still out of scope: generic bucket reporting, remaining-unit readers, and other bucket metrics that are not tied to recurring contract-backed billing selection
  - bucket usage period tables remain the source of truth for those out-of-scope readers until a follow-on plan deliberately unifies them

## Parity Matrix

The minimum comparison matrix for client-cadence parity must cover the cross-product below before contract cadence is enabled:

| Dimension | Required values |
| --- | --- |
| Billing frequency | monthly, quarterly, semi-annual, annual, weekly, bi-weekly |
| Due position | advance, arrears |
| Coverage shape | full period, mid-period start, mid-period end, no-coverage |
| Charge family | fixed recurring, recurring product, recurring license, recurring bucket / allowance where timing matters |
| Commercial modifiers | pricing schedules, discounts, custom contract rates, catalog rates |
| Financial overlays | purchase-order required, credits, prepayment, negative invoice follow-on |
| Downstream projections | invoice detail persistence, invoice preview rows, accounting exports, portal / report readers |

The initial fixture set must include at least:

- monthly client cadence anchored mid-month, both advance and arrears
- quarterly, semi-annual, and annual client cadence with anchored month/day behavior
- first partial period and final partial period coverage
- fixed, product, and license recurring families
- pricing schedule override and discount applicability overlays
- PO-required recurring lines
- credit / prepayment / negative invoice scenarios that consume recurring timing

## Parity Harness Contract

Pass-0 parity work needs an executable harness contract before cutover work begins. The harness does not require the service-period-first engine to exist yet, but it must define the comparison surface now.

### Inputs

- a fixture builder that emits one recurring scenario without requiring invoice persistence as a side effect
- a legacy adapter that can run today's recurring path:
  - `BillingEngine.calculateBilling(...)`
  - `generateInvoice(...)` when persistence comparison is required
- a candidate adapter contract that will run the canonical service-period-first path with the same fixture input

### Outputs to compare

- charge identity and family
- service-period boundaries
- due invoice window
- subtotal / tax / total
- invoice detail timing metadata
- downstream export row timing fields where applicable

### Blocking vs non-blocking drift

Blocking drift:

- changed charge count
- changed service-period boundaries
- changed due-window selection
- changed amounts, discount coverage, tax basis, or invoice grouping
- changed export- or portal-visible timing meaning

Non-blocking drift during staged rollout:

- additional explainability metadata
- new provenance fields
- additive trace metadata used only for parity comparison or future service-period-first rollout

## Fixture Builder Contract

Fixture builders for parity and shared-domain tests should be composable rather than charge-family-specific:

- base client cadence fixture:
  - frequency
  - anchor / reference date
  - invoice window
  - cadence owner
- assignment overlay:
  - start date
  - end date
- recurring obligation overlay:
  - charge family
  - billing timing
  - proration / partial-coverage expectations
- commercial overlay:
  - pricing schedule
  - discount
  - custom rate vs catalog rate
  - PO requirement
- financial overlay:
  - credit
  - prepayment
  - negative invoice follow-on

This keeps the future parity harness useful even after fixed recurring, product recurring, and license recurring all share the same canonical timing primitives.
