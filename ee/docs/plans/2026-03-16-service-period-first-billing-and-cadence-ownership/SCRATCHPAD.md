# Scratchpad — Service-Period-First Billing and Explicit Cadence Ownership

- Plan slug: `service-period-first-billing-and-cadence-ownership`
- Created: `2026-03-16`
- Replanned: `2026-03-17`

## What This Is

Keep a lightweight, continuously-updated log of discoveries, sequencing decisions, and subsystem impact notes for the service-period-first billing work.

This scratchpad was expanded on `2026-03-17` after concluding that the first draft plan was materially under-specified for the risk level of the change.

## Decisions

- (2026-03-16) Sequence this plan so service periods become canonical under existing client-cadence behavior before exposing contract-owned cadence. Parity first, new option second, cleanup last.
- (2026-03-16) Scope the first cut to recurring contract-backed charges. Time and usage remain on their current event-driven model unless a compatibility blocker appears.
- (2026-03-16) Treat invoice windows as the grouping layer and service periods as the recurring-billing truth for this plan.
- (2026-03-17) Replan this effort at system breadth rather than billing-engine breadth. The plan must explicitly cover invoice generation, invoice detail consumers, credits/prepayment/negative invoice behavior, APIs/models/repos, templates/wizards/forms, portal/report/export surfaces, migrations/defaulting, and post-cutover cleanup.
- (2026-03-17) Materialized service periods are now in-scope for v1. The main reason is product editability: if users need to change a future recurring period explicitly, a derived-only model pushes the system toward hidden overrides instead of a first-class editable billing object.
- (2026-03-17) Use recursive top-down decomposition for the feature/test lists:
  - architecture + parity
  - shared domain
  - client cadence
  - due-position and partial-period rules
  - fixed recurring
  - dependent recurring behaviors
  - invoice generation + billing flows
  - data model/API/UI
  - contract cadence
  - migration/cleanup
- (2026-03-17) Second-pass agent critique showed the plan still needed dedicated categories for:
  - recurring execution identity and scheduler payloads
  - invoice grouping and split legality
  - parent-charge versus detail-row read-model contracts
  - manual/prepayment/credit service-period policy
  - export adapter flattening rules
  - authoring-path propagation through templates, presets, and custom lines
  - stale dropped-table and repository normalization cleanup

## Discoveries / Constraints

- (2026-03-17) Pass-0 implementation artifacts now live in:
  - `ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PASS0_RECURRING_TIMING_APPENDIX.md`
  - `ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/pass-0-source-inventory.json`
  - `server/src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts`
- (2026-03-17) Shared recurring-timing primitives now live in:
  - `packages/types/src/interfaces/recurringTiming.interfaces.ts`
  - `shared/billingClients/recurringTiming.ts`
  - `packages/billing/src/lib/billing/recurringTiming.ts`
  - `server/src/test/unit/billing/recurringTiming.domain.test.ts`
- (2026-03-17) The first checkpoint intentionally made the plan executable:
  - source-backed file inventories now cover `resolveServicePeriod`, `billing_cycle_alignment`, persisted service-period readers, and downstream recurring timing consumers
  - a docs contract test now fails if the pass-0 appendix drifts from live grep-backed source references
- (2026-03-17) The second checkpoint intentionally kept the new timing domain additive and pure:
  - canonical service periods and invoice windows are distinct types with explicit `kind` markers and shared `[start, end)` semantics
  - cadence-owner defaults are centralized at `DEFAULT_CADENCE_OWNER = 'client'`
  - activity-window intersection, coverage calculation, due-window mapping, and invoice-detail timing projection are defined without invoice creation side effects
- (2026-03-16) `packages/billing/src/lib/billing/billingEngine.ts` currently mixes several timing models:
  - `resolveServicePeriod`
  - advance vs arrears branching
  - fixed-fee proration in one path
  - product/license proration later in a different path
- (2026-03-16) `billing_cycle_alignment` is surfaced across schema, repositories, APIs, and UI, but the execution model is not cleanly organized around it. This makes it a strong cleanup target once service periods are explicit.
- (2026-03-16) Current invoice timing tests are effectively asserting service-period behavior already, especially in `server/src/test/integration/billingInvoiceTiming.integration.test.ts`.
- (2026-03-16) The recurring-billing mental model shown to users today still leans on “enable proration for mid-month starts,” which is a symptom of implicit rather than canonical service periods.
- (2026-03-17) The blast radius is substantially wider than the first draft plan represented. Additional impacted surfaces identified during replan:
  - invoice generation and recurring billing runs
  - invoice detail persistence and billed-through calculations
  - credits, prepayment, and negative-invoice flows
  - purchase-order and pricing-schedule dependencies
  - accounting exports and service-period consumers
  - client portal invoice/plan details
  - reporting actions/definitions
  - repositories/models/schemas/test helpers
- (2026-03-17) Second-pass agent findings tightened the highest-risk seams:
  - `billingCycleId` is still the true execution identity in recurring runs and job handlers
  - invoice read models still hydrate mostly parent `invoice_charges`, not canonical detail rows
  - export preview still derives service periods from invoice headers in some paths
  - repository and model write paths normalize or silently drop timing fields inconsistently
  - template and preset authoring paths are still not guaranteed to propagate future cadence semantics
- (2026-03-17) Materialization adds a new class of risk the plan must own explicitly:
  - generation horizon
  - override provenance
  - billed-period locking
  - regeneration after contract edits
  - future-period edit operations and conflict handling
- (2026-03-17) The plan should explicitly avoid silently dragging time/usage into v1, while still specifying their compatibility boundaries and non-goals.

## Commands / Runbooks

- (2026-03-16) Recon:
  - `rg -n "resolveServicePeriod|applyProrationToPlan|_calculateProrationFactor|billing_cycle_alignment|billing_timing|client_billing_cycles" packages/billing/src/lib/billing server/src/test shared`
  - `sed -n '220,470p' packages/billing/src/lib/billing/billingEngine.ts`
  - `sed -n '2284,2595p' packages/billing/src/lib/billing/billingEngine.ts`
  - `sed -n '60,210p' server/src/test/integration/billingInvoiceTiming.integration.test.ts`
  - `sed -n '1,260p' shared/billingClients/createBillingCycles.ts`
- (2026-03-17) Replan breadth inventory:
  - `rg -n "billing_timing|service_period_start|service_period_end|billing_cycle_alignment|client_billing_cycles|generateInvoice|calculateBilling|billing_period_start|billing_period_end|proration" packages server shared`
  - `find server/src/test -maxdepth 3 -type f | rg "billing|invoice|contract|renewal|pricing|credit|report"`
  - `find packages -maxdepth 5 -type f | rg "billing|invoice|contract|renewal|report|pricing|accounting|BillingCycles|ContractLine|contractWizard|manualInvoice|quickBooks|xero"`
- (2026-03-17) Second-pass critique prompts:
  - runtime/dependent billing seams
  - invoice/downstream consumer seams
  - data model/API/UI/migration seams
- (2026-03-17) Plan validation:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership`
- (2026-03-17) Pass-0 appendix validation:
  - `npm --prefix server test -- src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts`
- (2026-03-17) Shared recurring-timing validation:
  - `npm --prefix server test -- src/test/unit/billing/recurringTiming.domain.test.ts src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts`
  - `npx vitest run src/interfaces/barrel.test.ts --root packages/types`

## Links / References

- Related plans:
  - `ee/docs/plans/2026-03-16-client-owned-contracts-simplification/`
  - `ee/docs/plans/2026-03-16-contract-template-normalization/`
- Pass-0 artifacts:
  - `ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PASS0_RECURRING_TIMING_APPENDIX.md`
  - `ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/pass-0-source-inventory.json`
- Key runtime files:
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - `packages/billing/src/lib/billing/recurringTiming.ts`
  - `shared/billingClients/createBillingCycles.ts`
  - `shared/billingClients/recurringTiming.ts`
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - `packages/billing/src/actions/recurringBillingRunActions.ts`
  - `packages/billing/src/repositories/accountingExportRepository.ts`
- Key UI/config files:
  - `packages/billing/src/components/billing-dashboard/ContractLineDialog.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/QuickStartGuide.tsx`
  - `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`
- Key tests:
  - `server/src/test/integration/billingInvoiceTiming.integration.test.ts`
  - `server/src/test/infrastructure/billing/invoices/*`
  - `server/src/test/infrastructure/billing/credits/*`
  - `server/src/test/unit/billingEngine.test.ts`
  - `server/src/test/unit/billing/billingEngine.timing.test.ts`

## Open Questions

- Where should `cadence_owner` live for v1?
- Does contract cadence change invoice timing as well as service-period boundaries?
- Which bucket/allowance behaviors must join v1 versus a follow-on?
- Which exact service-period edit operations belong in v1 versus a follow-on?
- What exact mixed-cadence invoice-grouping rule do we want if dates coincide versus diverge?
