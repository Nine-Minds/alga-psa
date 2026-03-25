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
- (2026-03-19 23:26 EDT) Client-cadence schedule regeneration can use the same surviving structure as due-work gap detection: load active obligations from `client_contracts -> contracts -> contract_lines`, alias `contract_line_id` to `client_contract_line_id`, and defer the actual obligation identity migration to the later F014/F015 work.
- (2026-03-19 23:49 EDT) `ContractLineService.validateNoOverlappingAssignments()` should validate duplicates against active cloned lines already present on the target client-owned contract, not against a removed per-client line table. After the drop, per-line assignment windows no longer exist independently from the client-owned contract lifecycle.
- (2026-03-19 23:56 EDT) The resolved post-drop identity rule is: client cadence keeps `obligation_type = 'client_contract_line'` only as passive compatibility metadata, while the canonical surviving obligation id is always the live `contract_line_id`. Shared helper functions should build that identity instead of re-encoding it inline.

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
- (2026-03-20 00:20 EDT) `client_contracts.notice_period_days` is `NOT NULL DEFAULT 30` after the renewal-config migration. The contract wizard create flow must mirror that default instead of inserting `null`.
- (2026-03-20 00:24 EDT) Client-cadence selector normalization cannot assume persisted `recurring_service_periods.obligation_type = 'client_contract_line'`. DB-backed coverage still materializes some client-cadence rows as `contract_line`, so live selector normalization must accept both post-drop obligation labels while continuing to resolve the surviving `contract_line_id`.
- (2026-03-20 00:25 EDT) `buildRecurringServicePeriodPeriodKey()` was assuming string dates, but Knex can surface `period_start_date` / `period_end_date` as `Date` objects in DB-backed due-work gap detection. The helper now normalizes both strings and `Date` instances.
- (2026-03-19 23:10 EDT) The existing due-work reader test harness was flexible enough to simulate a migrated schema by throwing on any attempted `client_contract_lines` access. That let the first checkpoint verify behavior rather than only string-match source code.
- (2026-03-19 23:16 EDT) `AutomaticInvoices` can be validated meaningfully without a database fixture by letting the component call the real `getAvailableRecurringDueWork()` action against mocked migrated-schema rows. That catches regressions in the UI load path instead of only checking a prebuilt mock payload.
- (2026-03-19 23:19 EDT) Preview/generate selector normalization for client cadence can follow the same post-drop lookup as due-work loading: `recurring_service_periods -> contract_lines -> contracts.owner_client_id`. The selector-input path only needs to prove the persisted service-period window belongs to the client; it does not need a dropped assignment row.
- (2026-03-19 23:21 EDT) Service-period inspection uses the same obligation-context rule: persisted client-cadence rows can resolve display metadata directly from `contract_lines -> contracts.owner_client_id`. No live inspection path needs a dropped client assignment row once the recurring service period already exists.
- (2026-03-19 23:26 EDT) `packages/billing/src/actions/clientCadenceScheduleRegeneration.ts` was the next stale runtime caller. Its query still started from `client_contract_lines`, and `server/src/test/unit/billing/updateClientBillingSchedule.test.ts` encoded that exact base table in its fake transaction responses.
- (2026-03-19 23:29 EDT) Invoice-detail linkage was still widening client-cadence obligation candidates through `client_contract_lines`. In the post-drop model that lookup is redundant because live client-cadence recurring service periods already use `obligation_type = 'client_contract_line'` with the surviving `contract_line_id` as `obligation_id`.
- (2026-03-19 23:30 EDT) Bucket period resolution had the same stale assumption: it only needed an active client assignment window plus the canonical contract line and bucket config, but it still started that lookup from `client_contract_lines`.
- (2026-03-19 23:35 EDT) Contract wizard create flow was already using surviving `contract_lines` and `client_contracts`, but `contractWizardActions.ts` still carried an unused helper that wrote `client_contract_lines`, `client_contract_services`, and related dropped tables. The integration test still asserted those dropped tables as expected output.
- (2026-03-19 23:39 EDT) `applyCreditToInvoice()` still contained a pure guard read against `client_contract_lines` before updating invoice/client balances. That read was not used for business logic and would hard-fail in migrated schemas.
- (2026-03-19 23:39 EDT) The billing overview report definition still counted active billing clients by joining `client_contract_lines`, even though the active client-owned model is `client_contracts -> contracts -> contract_lines`.
- (2026-03-19 23:49 EDT) `server/src/lib/api/services/ContractLineService.ts` no longer has live `client_contract_lines` reads/writes. Unassign, activation, usage metrics, analytics, in-use checks, and overlap validation now all resolve through `contract_lines`, `contracts`, and `client_contracts`.
- (2026-03-19 23:56 EDT) Client-cadence recurring identity had drifted into several inline string/tuple shims across due-work, regeneration, linkage, bucket resolution, selector normalization, service-period repair, and billing-engine materialization. A shared helper in `shared/billingClients/postDropRecurringObligationIdentity.ts` was enough to unify those paths without changing persisted compatibility types.
- (2026-03-19 23:59 EDT) The March 18 service-driven invoicing runbook still contained operator SQL starting from `client_contract_lines` plus cutover wording that implied a bridge table remained the live client-cadence source. The fix only needed localized wording/SQL edits; the rest of the runbook still applies.
- (2026-03-20 00:08 EDT) `server/src/test/unit/contractLineDisambiguation.test.ts` still encoded pre-drop bucket-overlay heuristics after the runtime helper switched to normalized post-drop rows. The stale test only needed mock-shape updates (`bucket_overlay.config_id`, normalized dates) rather than production code changes.
- (2026-03-20 00:08 EDT) A targeted static guard over tracked tests was enough to enforce `F016`: reject positive assertions that require `client_contract_lines` or `client_contract_services` to exist/live, while still allowing migrated-schema tests to mention the dropped tables in negative assertions and missing-table harnesses.
- (2026-03-20 00:14 EDT) `server/src/test/unit/billing/recurringInvoiceLinkage.static.test.ts` had drifted behind the new helper-based linkage implementation. The assertions needed to move from inline `obligation_type`/`obligation_id` string literals to `buildPostDropRecurringObligationCandidates(...)` plus candidate mapping.
- (2026-03-20 00:14 EDT) DB-backed integration verification is partially blocked locally because the test Postgres target is not listening on `127.0.0.1:5438` / `::1:5438`. `contractWizard.integration.test.ts` currently skips/fails at suite setup before exercising migrated-schema behavior.

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
- (2026-03-19 23:21 EDT) Verification for F006/T008:
  - `pnpm exec vitest run src/test/unit/billing/recurringServicePeriodActions.test.ts` (run from `server/`)
- (2026-03-19 23:26 EDT) Verification for F007/T009:
  - `pnpm exec vitest run src/test/unit/billing/updateClientBillingSchedule.test.ts` (run from `server/`)
- (2026-03-19 23:29 EDT) Verification for F008 linkage cleanup:
  - `pnpm exec vitest run src/test/unit/billing/invoiceService.fixedPersistence.test.ts src/test/unit/billing/recurringInvoiceLinkage.static.test.ts` (run from `server/`)
- (2026-03-19 23:30 EDT) Verification for F009 bucket period resolution:
  - `pnpm exec vitest run src/test/unit/billing/bucketUsageService.periods.test.ts` (run from `server/`)
- (2026-03-19 23:35 EDT) Verification for F010 contract wizard cleanup:
  - `pnpm exec vitest run src/test/unit/billing/contractWizard.postDrop.static.test.ts` (run from `server/`)
  - `pnpm exec vitest run src/test/integration/contractWizard.integration.test.ts` failed locally with `ECONNREFUSED` to `127.0.0.1:5438` / `::1:5438` because the DB-backed test Postgres was not available.
- (2026-03-19 23:39 EDT) Verification for F012/F013:
  - `pnpm exec vitest run src/test/unit/billing/creditActions.applyCredit.postDrop.test.ts src/test/unit/billing/billingOverviewReport.postDrop.static.test.ts` (run from `server/`)
- (2026-03-19 23:49 EDT) Verification for F011/F019:
  - `pnpm exec vitest run src/test/unit/api/contractLineService.clientOwnedMutation.test.ts src/test/unit/api/contractLineService.postDrop.static.test.ts` (run from `server/`)
- (2026-03-19 23:56 EDT) Verification for F014/F015:
  - `pnpm exec vitest run src/test/unit/billing/postDropRecurringObligationIdentity.test.ts src/test/unit/billing/recurringDueWorkReader.integration.test.ts src/test/unit/billing/updateClientBillingSchedule.test.ts src/test/unit/billing/invoiceService.fixedPersistence.test.ts src/test/unit/billing/bucketUsageService.periods.test.ts src/test/unit/billing/invoiceGeneration.preview.test.ts src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts src/test/unit/billing/recurringServicePeriodActions.test.ts src/test/unit/api/contractLineService.clientOwnedMutation.test.ts src/test/unit/api/contractLineService.postDrop.static.test.ts` (run from `server/`)
- (2026-03-19 23:59 EDT) Verification for F017 doc cleanup:
  - `pnpm exec vitest run src/test/unit/docs/clientContractLinePostDropHygiene.test.ts` (run from `server/`)
- (2026-03-20 00:08 EDT) Verification for F016/F020/T022/T023/T028:
  - `pnpm exec vitest run src/test/unit/contractLineDisambiguation.test.ts src/test/unit/docs/clientContractLinePostDropHygiene.test.ts src/test/unit/docs/clientContractLineTestAssertions.static.test.ts` (run from `server/`)
- (2026-03-20 00:12 EDT) Verification for T012/T016/T017/T018/T019/T020/T021/T027:
  - `pnpm exec vitest run src/test/unit/billing/clientContractLineRuntimeSourceGuards.static.test.ts src/test/unit/billing/contractWizard.postDrop.static.test.ts src/test/unit/billing/creditActions.applyCredit.postDrop.test.ts src/test/unit/billing/billingOverviewReport.postDrop.static.test.ts src/test/unit/billing/postDropRecurringObligationIdentity.test.ts src/test/unit/billing/bucketUsageService.periods.test.ts src/test/unit/api/contractLineService.clientOwnedMutation.test.ts src/test/unit/api/contractLineService.postDrop.static.test.ts` (run from `server/`)
- (2026-03-20 00:13 EDT) Verification for T011/T026:
  - `pnpm exec vitest run src/test/unit/billing/recurringInvoiceLinkage.static.test.ts` (run from `server/`)
  - `pnpm exec vitest run --coverage.enabled=false src/test/unit/billingEngine.test.ts -t "resolves preserved and cloned assignment lines from each assignment contract after migration"` (run from `server/`)
- (2026-03-20 00:12 EDT) Blocked DB-backed verification:
  - `pnpm exec vitest run src/test/integration/contractWizard.integration.test.ts` (run from `server/`) -> fails connecting to Postgres on port `5438`
- (2026-03-20 00:23 EDT) DB-backed verification after discovering the active local Postgres listener on `127.0.0.1:57433`:
  - `DB_HOST=127.0.0.1 DB_PORT=57433 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=postpass123 DB_USER_SERVER=app_user DB_PASSWORD_SERVER=postpass123 pnpm exec vitest run --coverage.enabled=false src/test/integration/contractWizard.integration.test.ts` (run from `server/`)
- (2026-03-20 00:31 EDT) Final DB-backed recurring verification:
  - `DB_HOST=127.0.0.1 DB_PORT=57433 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=postpass123 DB_USER_SERVER=app_user DB_PASSWORD_SERVER=postpass123 pnpm exec vitest run --coverage.enabled=false src/test/integration/billingInvoiceTiming.integration.test.ts -t "T033/T078|T034/T079|T085|T017/T019/T050/T077/T080/T084|T080: mixed batch generation from AutomaticInvoices"` (run from `server/`)
  - `pnpm exec vitest run --coverage.enabled=false src/test/unit/billing/invoiceService.fixedPersistence.test.ts -t "canonical client-contract-line identity|canonical contract-line identity"` (run from `server/`)

## Completed Items

- (2026-03-19 23:10 EDT) Completed `F001`: persisted client-cadence due-work loading no longer joins `client_contract_lines`; the reader resolves contract/client metadata via surviving `contract_lines` and `contracts.owner_client_id`.
- (2026-03-19 23:10 EDT) Completed `F002`: client-cadence materialization-gap detection now loads active recurring obligations from `client_contracts -> contracts -> contract_lines`, preserving the legacy `client_contract_line` logical identity only as compatibility metadata.
- (2026-03-19 23:10 EDT) Completed `T001`/`T002`/`T003`: due-work reader coverage now simulates a fully migrated schema by failing on any `client_contract_lines` access while still verifying persisted client cadence, persisted contract cadence, and client-cadence materialization gaps.
- (2026-03-19 23:16 EDT) Completed `F003`: `AutomaticInvoices` can load recurring due work in a simulated migrated schema with no `client_contract_lines` table because its server action path no longer depends on that table for due-work loading.
- (2026-03-19 23:16 EDT) Completed `T004`: the UI test now renders `AutomaticInvoices` while the real due-work action runs against mocked migrated-schema data and a hard failure on any `client_contract_lines` access.
- (2026-03-19 23:19 EDT) Completed `F004`/`F005`: selector-input preview/generate normalization for client-cadence windows no longer joins `client_contract_lines`; it resolves persisted windows through surviving `contract_lines` plus `contracts.owner_client_id`.
- (2026-03-19 23:19 EDT) Completed `T005`/`T006`/`T007`: preview and generation coverage now explicitly fails on any `client_contract_lines` access while verifying client-cadence selector-input preview, client-cadence selector-input generation, and contract-cadence regression behavior.
- (2026-03-19 23:21 EDT) Completed `F006`: recurring service-period management view resolves client-cadence obligation metadata from surviving contract-owned structures instead of `client_contract_lines`.
- (2026-03-19 23:21 EDT) Completed `T008`: service-period management view coverage now simulates a migrated schema by failing on any `client_contract_lines` access while still returning client/contract/line context for a client-cadence schedule.
- (2026-03-19 23:26 EDT) Completed `F007`: client-cadence schedule regeneration now loads active recurring obligations from `client_contracts -> contracts -> contract_lines` and aliases the surviving `contract_line_id` back to `client_contract_line_id` for compatibility, removing the dropped-table dependency from billing-schedule changes.
- (2026-03-19 23:26 EDT) Completed `T009`: billing-schedule regeneration coverage now seeds `client_contracts as cc`, treats `client_contract_lines` as missing, and still verifies regenerated recurring service periods are materialized and superseded correctly.
- (2026-03-19 23:29 EDT) Completed `F008`: invoice-detail linkage no longer queries `client_contract_lines` to derive client-cadence recurring obligation candidates. The live path now matches recurring service periods against the surviving `contract_line_id` for both `contract_line` and compatibility `client_contract_line` obligation types.
- (2026-03-19 23:30 EDT) Completed `F009`: bucket recurring period resolution now finds active client-cadence obligations through `client_contracts -> contracts -> contract_lines`, preserving compatibility-only `client_contract_line` obligation typing while using the surviving `contract_line_id` as the recurring obligation id.
- (2026-03-19 23:35 EDT) Completed `F010`: removed the dead per-client line replication helper from `contractWizardActions.ts` and rewrote contract wizard coverage to validate the surviving `client_contracts`, `contract_lines`, and `contract_line_service_*` structures instead of the dropped `client_contract_lines` / `client_contract_services` tables.
- (2026-03-19 23:39 EDT) Completed `F012`: credit application no longer queries `client_contract_lines` before applying client credit to an invoice. The live path now updates credit balances directly from invoice/client/credit-tracking state, which already contains the required domain information.
- (2026-03-19 23:39 EDT) Completed `F013`: the billing overview report definition now derives active billing clients from `client_contracts -> contracts -> contract_lines` instead of treating `client_contract_lines` as a live fact source.
- (2026-03-19 23:49 EDT) Completed `F011`: `ContractLineService` live mutation/runtime paths no longer require `client_contract_lines`. Client-owned unassign/deactivate behavior now updates canonical `contract_lines`, and duplicate assignment checks are scoped to the surviving client-owned contract structure.
- (2026-03-19 23:49 EDT) Completed `F019`: server-side contract-line service behaviors for unassign/deactivate, usage analytics, overview counts, in-use checks, and overlap validation no longer query `client_contract_lines`; they now join surviving `contract_lines -> contracts -> client_contracts` instead.
- (2026-03-19 23:56 EDT) Completed `F014`: defined a shared post-drop recurring obligation helper (`shared/billingClients/postDropRecurringObligationIdentity.ts`) and rewired due-work, regeneration, selector normalization, linkage, bucket resolution, service-period inspection, and billing-engine settlement code to use that canonical identity rule instead of inline string shims.
- (2026-03-19 23:56 EDT) Completed `F015`: the retained `client_contract_line` identity is now explicitly compatibility-only. Shared helpers document that it always points at the surviving `contract_line_id`, and live runtime paths consume that helper instead of implying a backing `client_contract_lines` table.
- (2026-03-19 23:59 EDT) Completed `F017`: corrected the active runbook under `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/RUNBOOK.md` so recurring repair guidance now starts from `client_contracts -> contracts -> contract_lines` and describes post-drop client cadence without implying `client_contract_lines` is still a live runtime dependency.
- (2026-03-20 00:08 EDT) Completed `F016`: updated stale unit/integration test coverage so post-drop contract-line helpers and test-suite guards no longer treat `client_contract_lines` or `client_contract_services` as expected live runtime structures.
- (2026-03-20 00:08 EDT) Completed `F020`: removed tracked backup artifacts, corrected cleanup-only integration fixtures/teardowns, and added hygiene assertions so active development/runbook flows no longer point engineers back at dropped client-contract line tables.
- (2026-03-20 00:14 EDT) Completed `T012`: bucket period resolution is guarded by `bucketUsageService.periods.test.ts`, which throws immediately if `client_contract_lines` is queried and verifies client-cadence periods still resolve through recurring service periods.
- (2026-03-20 00:14 EDT) Completed `T015` and `T027`: `contractLineService.clientOwnedMutation.test.ts` plus `contractLineService.postDrop.static.test.ts` cover live client-owned mutation paths and enforce that unassign/deactivate, overlap validation, analytics/in-use/overview source wiring no longer query `client_contract_lines`.
- (2026-03-20 00:14 EDT) Completed `T016`: `creditActions.applyCredit.postDrop.test.ts` proves client credit application succeeds when `client_contract_lines` throws as missing.
- (2026-03-20 00:14 EDT) Completed `T017`: `billingOverviewReport.postDrop.static.test.ts` now enforces the report definition's active-client metric joins `client_contracts -> contracts -> contract_lines` instead of `client_contract_lines`.
- (2026-03-20 00:14 EDT) Completed `T018`: `postDropRecurringObligationIdentity.test.ts` guards the shared helper and verifies due-work, regeneration, linkage, bucket resolution, and service-period paths all consume the same canonical post-drop identity helper.
- (2026-03-20 00:14 EDT) Completed `T019` and `T020`: `clientContractLineRuntimeSourceGuards.static.test.ts` scans tracked billing actions/services and rejects any runtime query-like use of dropped client-contract line tables.
- (2026-03-20 00:14 EDT) Completed `T021`: `contractWizard.postDrop.static.test.ts` enforces that client contract creation no longer inserts into `client_contract_lines` or `client_contract_services`.
- (2026-03-20 00:14 EDT) Completed `T026`: the focused `billingEngine.test.ts` migration regression proves client-owned contract loading still returns preserved and cloned assignment lines through the current `client_contracts -> contracts -> contract_lines` runtime shape.
- (2026-03-20 00:31 EDT) Completed `T013` and `T014`: `contractWizard.integration.test.ts` now passes against a fully migrated schema with no `client_contract_lines` / `client_contract_services` tables. The test harness was updated for the current auth/tenant seams, and the runtime create path now falls back to migration-aligned defaults for `renewal_mode` (`manual`) and `notice_period_days` (`30`).
- (2026-03-20 00:31 EDT) Completed `T010`: DB-backed reverse/delete repair coverage (`T033/T078`, `T034/T079`, `T085`) proves recurring invoice reversal and hard-delete reopen linked service periods without relying on dropped client-line tables.
- (2026-03-20 00:31 EDT) Completed `T011`: DB-backed client-cadence linkage coverage (`T029`) plus `invoiceService.fixedPersistence.test.ts` now verify billed recurring detail rows backfill through the canonical surviving `contract_line_id`, accepting both post-drop client-cadence obligation labels without querying `client_contract_lines`.
- (2026-03-20 00:31 EDT) Completed `T024`: the mixed `AutomaticInvoices` batch happy path now materializes both client- and contract-cadence service periods before selection, and DB-backed generation succeeds from the canonical selector input in a schema where the dropped client-line tables are absent.
- (2026-03-20 00:31 EDT) Completed `T025`: contract-cadence preview, generation, and recurring history remain functional after the post-drop cleanup, with selector-input execution windows and persisted service periods staying coherent without a required `billing_cycle_id`.
- (2026-03-20 00:31 EDT) Completed `F018`: after widening client-cadence selector normalization to both post-drop obligation labels and hardening recurring period-key normalization for DB date objects, the remaining DB-backed billing/runtime paths exercised by contract wizard creation, recurring repair, and `AutomaticInvoices` no longer crash in a fully migrated schema without `client_contract_lines`.

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
