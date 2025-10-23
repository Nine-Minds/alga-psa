# Arrears + Advance Billing Support Plan

## Purpose & Overview
Enable contract lines to specify whether they bill **in arrears** (after usage is known) or **in advance** (prepaid for the upcoming period) while keeping a single invoice per billing cycle. Each invoice line must carry its own service-period metadata so accounting, revenue recognition, and customer communication stay accurate.

Primary design requirements:

- Preserve one-invoice-per-cycle tooling; the billing run collects both arrears and advance lines.
- Support fixed-fee/recurring lines billing in advance; keep hourly/usage/bucket/licence lines arrears-only unless explicitly enabled later.
- Track service periods at the line-detail level to distinguish past and future charges on the same invoice.
- Maintain compatibility with existing contracts while allowing gradual adoption.

---

## Phase 0 – Discovery & Alignment *(Completed)*
- Findings to date:
  - Fixed-fee/recurring contract lines are the primary candidates for advance billing; hourly, usage, bucket, license, and product passthrough lines should remain arrears-only for launch to prevent speculative invoicing.
  - Current invoices rely on `invoices.billing_period_start` / `billing_period_end` as a single window, so per-line service periods must be introduced before mixed timing can ship.
  - Billing automation already executes at cycle boundaries (via `invoiceGeneration.ts`), so the mixed-timing model can reuse the existing schedule once line metadata is present.
- Discovery actions
  - [x] Catalogue contract-line types and document desired timing behaviour:
    - Contract line types observed: `'Fixed'`, `'Hourly'`, `'Usage'`, `'Bucket'` (`contract_lines.contract_line_type`); downstream billing also emits `product` and `license` charges from service configuration.
    - Timing matrix:
      | Line / charge category | Default timing | Notes |
      | --- | --- | --- |
      | Fixed fee contract lines | **Advance or arrears** (configurable) | Advance allowed because rate is known ahead of time; requires service-period tagging and cancellation credits. |
      | Hourly contract lines (`time_entries`) | **Arrears only** | Hours are reconciled after approval; advance billing would be speculative. |
      | Usage-based lines (`usage_tracking`) | **Arrears only** | Quantities recorded after consumption. |
      | Bucket retainers | **Arrears baseline** | Buckets roll usage from prior period; advance billing would need rollover logic. |
      | License / product passthrough | **Arrears for launch** | Quantities may change monthly; revisit advance after quantity-lock workflow exists. |
  - [x] Establish revenue-recognition & deferred revenue requirements:
    - Advance-billed fixed charges must post to deferred revenue and recognize over the service period; cancellations trigger prorated credits that reverse any unearned portion (to be handled by negative charges on subsequent invoices).
    - Arrears lines continue to recognize immediately at invoice finalization; no change needed.
    - Accounting exports will require the line-level service periods to drive recognition schedules; no separate approval loop required.
  - [x] Review existing billing jobs, invoice templates, and accounting exports for timing assumptions:
    - Automated invoice generation (`server/src/lib/actions/invoiceGeneration.ts`) couples each invoice to a single `client_billing_cycles` period; manual generation mirrors the same assumption.
    - Invoice templates pull `invoices.billing_period_*` and lack per-line service date placeholders; template helpers must be extended to read new metadata.
    - Accounting exports (GL/revenue reports) currently group by invoice period and would mis-classify advance revenue without additional context.
  - [x] Audit schema touchpoints that assume single-period invoices:
    - `invoices`: only header-level period columns; no per-line timing.
    - `invoice_items` / `invoice_item_details`: store service/config references but no service-period columns.
    - `BillingEngine.calculateBilling`: returns `IBillingCharge` without service-period info; downstream tax/discount logic assumes charges belong to invoice period.
    - Reports such as contract performance and revenue rely on invoice-level period joins; they will need to reference new detail columns.
  - [x] Produce summary of current “arrears-only” flow vs. target mixed timing:
    - **Current**: billing engine aggregates charges for the cycle just completed, invoice date aligns with period end, and all charges share one service window.
    - **Target**: single invoice per cycle contains two groups—arrears items (prior period) and advance items (next period)—with each line tagged with its own service period, enabling deferred revenue handling and clearer customer communication.

## Phase 1 – Data Model Extensions *(Completed)*
- Contract line terms
  - [x] Add `billing_timing` enum column (`'arrears' | 'advance'`) to:
    - `contract_template_line_terms`
    - `client_contract_line_terms`
    - any remaining tenant-specific contract line term tables (rename legacy “plan” tables as required by `docs/AI_coding_standards.md`).
  - [x] Backfill existing rows to `'arrears'` and set default/NOT NULL constraints.
- Invoice detail metadata
  - [x] Extend `invoice_item_details` with `service_period_start`, `service_period_end`, `billing_timing` (nullable, default to invoice header for backfill).
  - [x] Provide migration script to populate new columns from `invoices.billing_period_*`.
  - [x] Review RLS policies to ensure new columns remain tenant-scoped.
- Interface updates
  - [x] Update `server/src/interfaces/billing.interfaces.ts` (`IBillingCharge`, `IFixedPriceCharge`, etc.) to carry service-period and timing fields.
  - [ ] Update invoice DTOs / API schemas to accept the new metadata.
  - [x] Ensure `docs/billing.md` references the new columns in the database quick reference table.
- Indexes & constraints
  - [x] Add covering indexes for `(tenant, service_period_start, service_period_end)` on `invoice_item_details` to support reporting.
  - [x] Verify FK relationships (invoice items → details, service catalog, contract lines) tolerate nullable service-period columns during backfill.
  - [ ] Update seed/test fixtures to populate timing fields so regression tests cover both arrears and advance data.

## Phase 2 – Contract Authoring & Assignment *(Planned)*
- Admin UX
  - [x] Add a timing selector (Radio/Switch from `server/src/components/ui`) to contract-line configuration and template editors, defaulting to arrears in line with `docs/overview.md` billing summary.
  - [x] Honour AI coding standards by labeling fields as “Billing Timing” and using contract terminology (no “plans” wording).
- Server logic
  - [x] Clone `billing_timing` when creating client contract lines via `cloneTemplateContractLine`.
  - [ ] In `contractActions` / `clientContractLineActions`, block timing switches if the line already has invoices; prompt for cancellation credit workflow.
  - [x] Extend validation so only fixed-fee contract lines can be set to advance at launch; log telemetry if other types attempt to switch.
- Migration assistance
  - [ ] Produce an admin report showing active contracts with eligible lines still in arrears to ease phased rollout.
  - [x] Document timing rules in `docs/billing.md` under Contract Lifecycle.

## Phase 3 – Billing Engine Enhancements *(In Progress)*
- Data hydration
  - [x] Extend `getClientContractLinesAndCycle` to include `billing_timing` and store it on the in-memory line object.
- Fixed-charge calculation
  - [x] In `calculateFixedPriceCharges`, when `billing_timing = 'advance'`:
    - [x] Compute future period using `getNextBillingDate`.
    - [x] Populate `service_period_start/end` and `billing_timing` on each returned charge.
    - [x] Prevent duplicates by checking existing invoice items with matching line + service period.
  - [x] When a prepaid line ends mid-cycle, generate a negative charge (credit) for unused portion in the next arrears run.
- Other calculators
  - [x] Ensure hourly/usage/bucket calculators ignore advance mode and always produce arrears charges.
  - [ ] Update proration helpers to read service-period fields.
- Plumbing
  - [ ] Pass timing metadata through discount/adjustment routines so downstream logic respects the service period.

## Phase 4 – Invoice Persistence *(Planned)*
- Persistence flow
  - [ ] Modify invoice item persistence (in `invoiceService.persistInvoiceItems`) to write `service_period_start/end/billing_timing` to `invoice_item_details`.
  - [ ] Store a derived `invoice_billing_mode` on `invoices` (enum: `'arrears'`, `'advance'`, `'mixed'`) for quick filtering.
- Tax & discounts
  - [ ] Update `calculateAndDistributeTax` to use the detail service period when determining tax effective date/region.
  - [ ] Ensure discounts/adjustments apply using the same service-period metadata.
- Cycle guarding
  - [ ] Update `hasExistingInvoiceForCycle` to allow advance + arrears items in one invoice while preventing multiple charges for the same future period.

## Phase 5 – Scheduling & Automation *(Planned)*
- [ ] Review automatic invoice cron to ensure it runs at cycle boundary and can fetch both arrears and advance lines without additional scheduling.
- [ ] Optionally allow a configurable lead time (e.g., invoice 3 days before period start) for advance lines once MVP is stable.
- [ ] Update manual “Generate Invoice” workflows to display both timing groups before finalization.
- [ ] Confirm failure retries use idempotent service-period checks so advance charges aren’t duplicated.

## Phase 6 – UI & Documentation *(Planned)*
- Customer-facing output
  - [ ] Update invoice PDFs/templates to group items by service period (using `invoice_item_details` metadata).
  - [ ] Provide per-line labels like “Service Period: 2025-08-01 → 2025-08-31”.
  - [ ] Ensure invoice template system (`docs/invoice_templates.md`) uses `invoice_template_assignments` as required by AI coding standards.
- Admin docs
  - [ ] Expand `docs/billing.md` with a section on mixed-timing invoices (include diagrams or sequence similar to overview doc).
  - [ ] Draft knowledge-base article for support/sales teams describing advance vs arrears settings.

## Phase 7 – Reporting & Analytics *(Planned)*
- [ ] Update revenue recognition jobs/exports to reference `service_period_start/end`.
- [ ] Adjust dashboards (MRR, contract performance) to subtract advance revenue from current-period totals and recognize in correct window.
- [ ] Add filters in reporting UI to segment advance vs arrears amounts per invoice/contract/client.
- [ ] Ensure reconciliation tooling leverages the new detail columns for auditing.

## Phase 8 – QA & Rollout *(Planned)*
- Testing
  - [ ] Add unit/integration tests for advance fixed lines, mixed invoices, and cancellation credits.
  - [ ] Introduce regression tests to confirm arrears-only tenants remain unaffected.
- Migration verification
  - [ ] Build smoke tests to verify backfilled service-period data matches invoice headers for legacy records.
- Release
  - [ ] Enable feature flag for internal tenant; monitor accounting outputs.
  - [ ] Prepare release notes, changelog entries, and customer comms.
  - [ ] Roll out to GA once telemetry confirms stable operation.

---

## Long-Term Follow-Ups
- [ ] Automate credit reconciliation for unused prepaid value at period end.
- [ ] Evaluate enabling advance timing for other line categories (license/product) once quantity forecasting is mature.
- [ ] Align deferred revenue postings with external accounting integrations for tighter audit trails.
