# Scratchpad — Client Contract Line Post-Drop Cutover

- Plan slug: `client-contract-line-post-drop-cutover`
- Created: `2026-03-19`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-19) Scope includes both runtime fixes and cleanup. The user explicitly requested that the plan cover broader stale code/tests/docs cleanup, not just the immediate `AutomaticInvoices` crash.
- (2026-03-19) Treat fully migrated environments as the source of truth. The migration dropping `client_contract_lines` has already run in the target branch/env, so runtime code must adapt to the surviving structure instead of restoring compatibility with removed tables.
- (2026-03-19) The plan assumes the intended live structure is: `contracts` as client-owned header, `contract_lines` as canonical line obligation, `client_contracts` as assignment/lifecycle layer.
- (2026-03-19) The likely post-drop recurring identity target is `contract_line_id` for the line plus `client_contract_id` / `client_contracts` for assignment windowing. If `client_contract_line` survives at all, it should survive only as compatibility metadata, not as a live storage dependency.
- (2026-03-19 23:10 EDT) For `getAvailableRecurringDueWork()`, client-cadence persisted rows can resolve directly through `recurring_service_periods -> contract_lines -> contracts.owner_client_id` because the invoice/service-period window is already materialized. Materialization-gap detection still needs `client_contracts` for active assignment windows, but maps `contract_line_id` back into the compatibility field `client_contract_line_id`.

## Discoveries / Constraints

- (2026-03-19) `AutomaticInvoices` 500s in a migrated environment because `getAvailableRecurringDueWork()` still queries `client_contract_lines` in both persisted due-work loading and materialization-gap detection.
- (2026-03-19) Recurring preview/generate, recurring service-period inspection, and client-cadence regeneration also still query `client_contract_lines`.
- (2026-03-19) Contract wizard comments say `client_contract_lines` and related tables are redundant, but the create flow still inserts into `client_contract_lines` and `client_contract_services`.
- (2026-03-19) The billing engine has already partially moved to the post-drop model and loads line truth via `client_contracts -> contracts -> contract_lines`, aliasing `contract_line_id` back to `client_contract_line_id` for compatibility.
- (2026-03-19) Tests currently mask the mismatch. Some tests explicitly mock or assert `client_contract_lines` as expected live behavior, including a static linkage guard.
- (2026-03-19) The deeper unresolved design issue is recurring identity: client cadence still widely uses `obligation_type = 'client_contract_line'` and `client_contract_line_id` even though the physical table is gone.
- (2026-03-19) Additional live cleanup targets identified: `server/src/lib/api/services/ContractLineService.ts`, `server/src/lib/reports/definitions/billing/overview.ts`, `packages/billing/src/actions/creditActions.ts`, and a long tail of credit/invoice integration tests that still seed or assert `client_contract_lines`.
- (2026-03-19) Stale operational guidance also exists in `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/RUNBOOK.md`, which still starts repair SQL from `client_contract_lines`.
- (2026-03-19) Low-priority hygiene cleanup remains worthwhile because tracked backup files and teardown-only fixtures still keep the dropped table visible in active engineering flows.
- (2026-03-19 23:10 EDT) The existing due-work reader test harness was flexible enough to simulate a migrated schema by throwing on any attempted `client_contract_lines` access. That let the first checkpoint verify behavior rather than only string-match source code.
- (2026-03-19 23:16 EDT) `AutomaticInvoices` can be validated meaningfully without a database fixture by letting the component call the real `getAvailableRecurringDueWork()` action against mocked migrated-schema rows. That catches regressions in the UI load path instead of only checking a prebuilt mock payload.
- (2026-03-19 23:19 EDT) Preview/generate selector normalization for client cadence can follow the same post-drop lookup as due-work loading: `recurring_service_periods -> contract_lines -> contracts.owner_client_id`. The selector-input path only needs to prove the persisted service-period window belongs to the client; it does not need a dropped assignment row.

## Commands / Runbooks

- (2026-03-19) Reproduce current failure:
  - open `/msp/billing?tab=invoicing&subtab=generate`
  - observe `relation "client_contract_lines" does not exist`
- (2026-03-19) Find live dropped-table references:
  - `rg -n "client_contract_lines|client_contract_services|client_contract_line_pricing|client_contract_line_discounts" packages/billing/src server/src/lib -g '*.ts' -g '*.tsx'`
- (2026-03-19) Primary runtime files identified:
  - `packages/billing/src/actions/billingAndTax.ts`
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - `packages/billing/src/actions/recurringServicePeriodActions.ts`
  - `packages/billing/src/actions/clientCadenceScheduleRegeneration.ts`
  - `packages/billing/src/services/invoiceService.ts`
  - `packages/billing/src/services/bucketUsageService.ts`
  - `packages/billing/src/actions/contractWizardActions.ts`
- (2026-03-19) Additional cleanup inventory from agent sweep:
  - live server/service cleanup:
    - `server/src/lib/api/services/ContractLineService.ts`
    - `server/src/lib/reports/definitions/billing/overview.ts`
    - `packages/billing/src/actions/creditActions.ts`
  - stale tests to rewrite:
    - `server/src/test/integration/contractWizard.integration.test.ts`
    - `server/src/test/unit/billing/recurringInvoiceLinkage.static.test.ts`
    - `server/src/test/unit/billing/recurringDueWorkReader.integration.test.ts`
    - `server/src/test/unit/billing/updateClientBillingSchedule.test.ts`
    - `server/src/test/unit/billing/bucketUsageService.periods.test.ts`
    - `server/src/test/unit/billing/invoiceService.fixedPersistence.test.ts`
    - multiple credit and invoice integration tests under `server/src/test/infrastructure/billing`
  - docs/runbook/hygiene cleanup:
    - `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/RUNBOOK.md`
    - tracked backups `server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts.bak*`
- (2026-03-19 23:10 EDT) Verification for F001/F002/T001/T002/T003:
  - `pnpm exec vitest run src/test/unit/billing/recurringDueWorkReader.integration.test.ts` (run from `server/`)
- (2026-03-19 23:16 EDT) Verification for F003/T004:
  - `pnpm exec vitest run src/test/unit/billing/recurringDueWorkReader.integration.test.ts src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx` (run from `server/`)
- (2026-03-19 23:19 EDT) Verification for F004/F005/T005/T006/T007:
  - `pnpm exec vitest run src/test/unit/billing/invoiceGeneration.preview.test.ts src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts` (run from `server/`)

## Completed Items

- (2026-03-19 23:10 EDT) Completed `F001`: persisted client-cadence due-work loading no longer joins `client_contract_lines`; the reader resolves contract/client metadata via surviving `contract_lines` and `contracts.owner_client_id`.
- (2026-03-19 23:10 EDT) Completed `F002`: client-cadence materialization-gap detection now loads active recurring obligations from `client_contracts -> contracts -> contract_lines`, preserving the legacy `client_contract_line` logical identity only as compatibility metadata.
- (2026-03-19 23:10 EDT) Completed `T001`/`T002`/`T003`: due-work reader coverage now simulates a fully migrated schema by failing on any `client_contract_lines` access while still verifying persisted client cadence, persisted contract cadence, and client-cadence materialization gaps.
- (2026-03-19 23:16 EDT) Completed `F003`: `AutomaticInvoices` can load recurring due work in a simulated migrated schema with no `client_contract_lines` table because its server action path no longer depends on that table for due-work loading.
- (2026-03-19 23:16 EDT) Completed `T004`: the UI test now renders `AutomaticInvoices` while the real due-work action runs against mocked migrated-schema data and a hard failure on any `client_contract_lines` access.
- (2026-03-19 23:19 EDT) Completed `F004`/`F005`: selector-input preview/generate normalization for client-cadence windows no longer joins `client_contract_lines`; it resolves persisted windows through surviving `contract_lines` plus `contracts.owner_client_id`.
- (2026-03-19 23:19 EDT) Completed `T005`/`T006`/`T007`: preview and generation coverage now explicitly fails on any `client_contract_lines` access while verifying client-cadence selector-input preview, client-cadence selector-input generation, and contract-cadence regression behavior.

## Links / References

- `ee/docs/plans/2026-03-16-client-owned-contracts-simplification/PRD.md`
- `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/PRD.md`
- `ee/docs/plans/2026-03-18-recurring-invoicing-hard-cutover/PRD.md`
- `server/migrations/20251207140000_drop_redundant_client_contract_tables.cjs`
- `packages/billing/src/lib/billing/billingEngine.ts`
- `packages/billing/src/actions/billingAndTax.ts`
- `packages/billing/src/actions/invoiceGeneration.ts`
- `server/src/test/unit/billing/recurringInvoiceLinkage.static.test.ts`
- `server/src/test/unit/billing/recurringDueWorkReader.integration.test.ts`
- `server/src/lib/api/services/ContractLineService.ts`
- `server/src/lib/reports/definitions/billing/overview.ts`
- `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/RUNBOOK.md`

## Open Questions

- Should client-cadence recurring obligations migrate fully to `obligation_type = 'contract_line'`, or is a logical `client_contract_line` identity still required as compatibility metadata?
- Which deprecated server/package services should be fixed in this plan versus deferred once live billing/runtime paths are stable?
- Which historical plans/design notes should remain untouched as historical artifacts, and which still influence operator or engineer behavior enough that they need explicit correction now?
