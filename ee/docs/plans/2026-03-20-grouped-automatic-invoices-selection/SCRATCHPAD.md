# Scratchpad — Grouped Automatic Invoices Selection

- Plan slug: `grouped-automatic-invoices-selection`
- Created: `2026-03-20`

## What This Is

Working notes for the grouped automatic-invoices selection redesign. This plan intentionally spans both UI and backend invoice-scope behavior.

## Decisions

- (2026-03-20) Group recurring due work visually by `client + invoice window`. Parent grouping is for user comprehension first, not an automatic promise that the result is one invoice.
- (2026-03-20) Parent checkbox semantics are strict: if enabled and selected, it means “generate one combined invoice.” If the group cannot combine, the parent checkbox is disabled rather than overloaded.
- (2026-03-20) `Select All` must be smart: select the parent for combinable groups and select child rows individually for non-combinable groups.
- (2026-03-20) Combined execution is allowed only when the selected children share compatible invoice-level financial scope: client, currency, PO scope, tax source, and export shape.
- (2026-03-20) Multi-assignment combined invoices are explicitly in scope for this plan. The backend must stop requiring a fake single invoice owner for valid combined selections.

## Discoveries / Constraints

- (2026-03-20) `AutomaticInvoices` already receives parent candidate rows with `members`, but the UI still behaves as a flat table and selection is only `Set<candidateKey>`. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Preview is currently gated to a single selected candidate with exactly one child member. Grouped preview behavior does not exist today.
- (2026-03-20) The shared grouping logic already computes split reasons `single_contract`, `purchase_order_scope`, and `financial_constraint` per invoice window. Files: `shared/billingClients/recurringTiming.ts`, `packages/billing/src/actions/billingAndTax.ts`.
- (2026-03-20) The current preview/generate APIs are strictly single-selector. `IRecurringDueSelectionInput` represents one selector only; generation scopes to one canonical line/window before billing. Files: `packages/types/src/interfaces/recurringTiming.interfaces.ts`, `packages/billing/src/actions/invoiceGeneration.ts`.
- (2026-03-20) Current recurring generation explicitly throws if charges span more than one `client_contract_id`. A true combined multi-assignment invoice is not representable without backend changes. File: `packages/billing/src/actions/invoiceGeneration.ts`.
- (2026-03-20) PO enforcement and consumption are currently header-assignment scoped through `invoices.client_contract_id`, so grouped combination must not bypass PO compatibility constraints. Files: `packages/billing/src/services/purchaseOrderService.ts`, `packages/billing/src/actions/invoiceQueries.ts`.
- (2026-03-20) Charge-level assignment attribution exists on `invoice_charges`, but invoice read models do not currently expose enough of that provenance for a combined invoice UX. Files: `packages/billing/src/services/invoiceService.ts`, `packages/billing/src/models/invoice.ts`.

## Commands / Runbooks

- (2026-03-20) Scaffolded this plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Grouped Automatic Invoices Selection" --slug grouped-automatic-invoices-selection`
- (2026-03-20) Validate the plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection`
- (2026-03-20) JSON sanity:
  - `jq empty ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection/features.json`
  - `jq empty ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection/tests.json`

## Links / References

- Related plan: `ee/docs/plans/2026-03-20-multi-active-contracts-per-client/`
- UI entry point: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
- Grouping logic: `shared/billingClients/recurringTiming.ts`
- Due-work shaping: `packages/billing/src/actions/billingAndTax.ts`
- Execution path: `packages/billing/src/actions/invoiceGeneration.ts`
- Recurring run actions: `packages/billing/src/actions/recurringBillingRunActions.ts`
- Invoice persistence: `packages/billing/src/services/invoiceService.ts`
- PO behavior: `packages/billing/src/services/purchaseOrderService.ts`

## Progress Log

- (2026-03-20) Codified parent/child selection semantics directly in `AutomaticInvoices` with `RecurringInvoiceParentGroup` and `buildRecurringInvoiceParentGroups`, so parent rows are explicit model objects and child members are explicitly treated as execution units. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Updated ready-work explanatory copy to align with PRD semantics: parent rows group by `client + invoice window`; child obligations remain atomic execution units. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Added a jsdom UI behavior test that mocks due-work responses and verifies one top-level automatic-invoices row renders for a multi-member shared `client + invoice window` candidate. File: `packages/billing/tests/automaticInvoices.groupedParentRows.test.tsx`.
- (2026-03-20) Targeted validation for the new grouped parent-row behavior test:
  - `cd packages/billing && npx vitest run tests/automaticInvoices.groupedParentRows.test.tsx`
- (2026-03-20) Completed `F002` by refactoring the ready-work UI model into explicit parent summaries (`parentSummary`) and child execution rows (`childExecutionRows`), while keeping generation/preview wired to selected parent-group candidates. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Completed `F003` by introducing explicit parent-group identity (`parentGroupKey`) and parent-selection identity (`parentSelectionKey`) in the ready-work view model, and routing group selection state through those keys instead of child selector identities. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Added optional parent aggregate amount summary (`aggregateAmountCents`) derived from child rows when amount data is present, with an explicit fallback when unavailable. File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Completed `T002` by asserting grouped parent summary output (child count, invoice window label, aggregate amount) in the automatic invoices jsdom behavior test. File: `packages/billing/tests/automaticInvoices.groupedParentRows.test.tsx`.

## Open Questions

- Should multi-invoice preview render several full invoice previews or a summary-first experience with drill-down?
- Should combined multi-assignment invoices expose a dedicated badge or invoice-scope type in history/detail screens?
- Should parent totals show only ready children or both ready and blocked totals when a group contains a mix?
