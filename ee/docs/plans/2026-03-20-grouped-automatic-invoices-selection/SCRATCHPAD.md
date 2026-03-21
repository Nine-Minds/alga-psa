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
- (2026-03-20) Grouped preview now supports exact parent/child selection bundles through `previewGroupedInvoicesForSelectionInputs`, while direct "Generate from preview" remains intentionally single-selector until grouped generation semantics (`F015/F016`) land. Files: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`, `packages/billing/src/actions/invoiceGeneration.ts`.
- (2026-03-20) Grouped generation request semantics now exist via `generateGroupedInvoicesAsRecurringBillingRun`, and `AutomaticInvoices` now submits grouped targets (`groupKey + selectorInputs`) for bulk generation paths instead of only flattened single-selector targets. Files: `packages/billing/src/actions/recurringBillingRunActions.ts`, `packages/billing/src/actions/recurringBillingRunActions.shared.ts`, `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-20) Combined grouped execution now routes through a multi-selector generation path (`generateInvoiceForSelectionInputs`) so one selected parent group can execute as one invoice request; incompatible child-level selections still fan out via one request per child group. File: `packages/billing/src/actions/invoiceGeneration.ts`, `packages/billing/src/actions/recurringBillingRunActions.ts`.
- (2026-03-20) Current combined grouped execution still enforces single `client_contract_id` at persistence time (`getSingleClientContractIdFromCharges`), so true multi-assignment combined invoices remain pending (`F020`/`F021`). File: `packages/billing/src/actions/invoiceGeneration.ts`.
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
- (2026-03-20) Completed `F004` with explicit parent-row expand/collapse controls and inline child-row rendering in the automatic invoices grouped table.
- (2026-03-20) Completed `F006` by rendering child details in the expanded group view, including assignment/contract context, cadence source, billing timing, service period, and amount.
- (2026-03-20) Completed `F005` by rendering parent summary combinability state alongside client, window, child-count, and aggregate-amount summaries.
- (2026-03-20) Completed `T003` by testing parent expansion and verifying child detail rendering in the automatic invoices grouped UI behavior test.
- (2026-03-20) Added financial-scope fields (`purchaseOrderScopeKey`, `currencyCode`, `taxSource`, `exportShapeKey`) to recurring due-work rows/candidates and wired those fields through due-work shaping so UI combinability logic can evaluate true invoice-scope compatibility.
- (2026-03-20) Completed `F007` by computing parent combinability from effective child scope values (client, currency, PO scope, tax source, export shape) and completed `F008` by enabling parent selection only when combinable.
- (2026-03-20) Completed `F012` by surfacing explicit non-combinable reason text on parent rows (`PO scope differs`, `Currency differs`, `Tax treatment differs`, `Export shape differs`).
- (2026-03-20) Completed `T004`-`T008` with scenario tests that verify combinability gating and each incompatibility reason.
- (2026-03-20) Validation run:
  - `cd packages/billing && npx vitest run tests/automaticInvoices.groupedParentRows.test.tsx`
  - `npm -w packages/billing run typecheck` (fails due existing unrelated package-level TS errors; see `billingCycleActions.ts`, `recurringBillingRunActions.shared.ts`, `billingEngine.ts`, `invoiceService.ts`, plus recurring due-window typing drift around `duePosition`).
- (2026-03-20) Completed `F009` by introducing dual parent/child selection targets, child-level checkbox selection in expanded groups, and parent tri-state behavior when child selections are partial.
- (2026-03-20) Completed `F010` by implementing smart `Select All`: combinable groups select parent targets, non-combinable groups select child targets.
- (2026-03-20) Completed `F011` by keeping blocked child rows visible while preventing blocked child selection in both direct child selection and `Select All`.
- (2026-03-20) Completed `T009`-`T014` with UI behavior tests covering parent selection semantics, child selection availability, parent tri-state, smart `Select All`, and blocked child visibility/selection guardrails.
- (2026-03-20) Completed `F013` by adding grouped preview request semantics end-to-end: `AutomaticInvoices` now emits grouped preview payloads from parent/child selection state and `invoiceGeneration` now exposes `previewGroupedInvoicesForSelectionInputs` with exact selector-scope support.
- (2026-03-20) Completed `F014` by updating preview rendering to show explicit invoice-count messaging (`This selection will generate N invoice(s).`) and render grouped preview cards for one-or-many preview outputs.
- (2026-03-20) Completed `T015`-`T017` with jsdom behavior tests that validate grouped parent preview count, split child preview count, and exact-scope preview payloads (no unselected siblings).
- (2026-03-20) Completed `F015` by introducing grouped generation payload semantics and wiring automatic-invoice generation calls to submit explicit grouped targets derived from parent/child selection state.
- (2026-03-20) Completed `F016` by preserving exact selector scope through grouped generation payloads and preventing sibling re-expansion in execution request construction.
- (2026-03-20) Completed `F017` by adding a grouped run execution loop that calls multi-selector invoice generation once per selected combinable parent group.
- (2026-03-20) Completed `F018` by preserving fan-out execution for incompatible selections via grouped run targets where each child selection executes independently.
- (2026-03-20) Completed `F019` by ensuring grouped recurring run execution skips duplicate selections (idempotent duplicate code path) while continuing unrelated selected groups in the same run.
- (2026-03-20) Completed `T020` with a jsdom behavior test that asserts generation sends only explicitly selected child selectors even when the group contains additional siblings.
- (2026-03-20) Completed `T018` and `T019` with server unit tests that verify grouped run execution creates one invoice for a combinable parent group and multiple invoices for split child groups.
- (2026-03-20) Completed `T021` with server unit coverage that verifies duplicate grouped/member selections are skipped without blocking unrelated sibling groups.
- (2026-03-20) Validation run:
  - `cd packages/billing && npx vitest run tests/automaticInvoices.groupedParentRows.test.tsx`
  - `cd server && npx vitest run src/test/unit/billing/recurringBillingRunActions.test.ts`

## Open Questions

- Should multi-invoice preview render several full invoice previews or a summary-first experience with drill-down?
- Should combined multi-assignment invoices expose a dedicated badge or invoice-scope type in history/detail screens?
- Should parent totals show only ready children or both ready and blocked totals when a group contains a mix?
