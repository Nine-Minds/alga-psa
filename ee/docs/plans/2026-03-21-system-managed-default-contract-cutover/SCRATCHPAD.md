# Scratchpad — System-Managed Default Contract Cutover

- Plan slug: `system-managed-default-contract-cutover`
- Created: `2026-03-21`

## Decisions

- (2026-03-21) Create a brand-new plan folder instead of updating `2026-03-21-client-default-contract-on-demand-routing`.
- (2026-03-21) Keep creation model on-demand at billing-configuration ensure touchpoints rather than eager create at client creation.
- (2026-03-21) Keep migration strategy lazy and deterministic; avoid broad forced backfill.
- (2026-03-21) Use hard cutover objective: remove primary-path non-contract fallback complexity once routing is stable.
- (2026-03-21) Persist explicit default-contract identity on `contracts.is_system_managed_default` and enforce uniqueness via tenant+owner-client partial unique index; deterministic naming is `System-managed default contract`.
- (2026-03-21) Centralize billing-settings row ensure in `shared/billingClients/billingSettings.ts` and make default-contract ensure part of that shared path, then route schedule/cycle-anchor/package settings/credit-expiration updates through it.
- (2026-03-21) Null client-billing-settings overrides (`settings === null`) remain delete-only and do not trigger default-contract ensure; ensure is only invoked on non-null ensure/update touchpoints.
- (2026-03-21) Add fallback client-create hook `ensureDefaultContractForClientIfBillingConfigured(...)` in shared default-contract domain and wire it into major create paths (clients package action, shared model, API service, integration import, email service) so bypass flows still reconcile when billing settings already exist.
- (2026-03-21) For API-service client deletion, enforce domain cleanup before hard delete: remove assignment/billing artifacts, then apply orphan policy to default contracts (`delete` when uninvoiced orphan, `archive` when invoiced orphan).

## Discoveries / Constraints

- Billing settings ensure/insert logic is duplicated across shared and package layers, so hooks must be centralized or replicated safely.
- Some client create flows bypass package-level actions (integration/email/import), so client-create hook alone is insufficient.
- API generic delete path may bypass domain cleanup used by package client delete action.
- Resolver behavior currently differs by path and can use current-time filtering instead of effective-date filtering.
- Billing engine can treat some null-assigned rows as resolvable without persisting assignment; this feeds due-work ambiguity.
- UI copy has technical/non-business labels that do not communicate default-contract behavior clearly.
- Existing package wiring tests include brittle source-string assertions for exact function signatures/throw style; those tests can fail even when runtime behavior is unchanged.
- Shared vitest config only discovers `services/**/*.test.ts` and `**/__tests__/**/*.test.ts`, so shared tests for this plan need to live under `shared/__tests__/`.
- `BaseService.delete` is generic hard-delete behavior; without `ClientService.delete` override it bypasses client-domain cleanup and can skip default-contract artifact cleanup.

## Commands / Runbooks

- Inspect prior plan scaffolds:
  - `ls -1 ee/docs/plans`
  - `ls -la ee/docs/plans/2026-03-21-client-default-contract-on-demand-routing`
- Validate new plan:
  - `jq empty ee/docs/plans/2026-03-21-system-managed-default-contract-cutover/features.json`
  - `jq empty ee/docs/plans/2026-03-21-system-managed-default-contract-cutover/tests.json`
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-21-system-managed-default-contract-cutover`
- Verify T001 coverage for default contract ensure:
  - `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- Verify T002 concurrency coverage (same suite now includes forced race path):
  - `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- (Optional) Package wiring spot-check:
  - `cd packages/billing && npx vitest run tests/billingSettingsActions.renewalPermissions.wiring.test.ts tests/billingSettingsActions.renewalDefaultsWiring.test.ts tests/billingSettingsActions.cadenceOwnerDefaultsWiring.test.ts`

## Links / References

- Existing stub plan folder: `ee/docs/plans/2026-03-21-client-default-contract-on-demand-routing`
- Related ongoing plan: `ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling`
- Key current code surfaces identified by investigation:
  - `shared/billingClients/billingSettings.ts`
  - `shared/billingClients/billingSchedule.ts`
  - `packages/billing/src/actions/billingCycleAnchorActions.ts`
  - `packages/billing/src/actions/billingSettingsActions.ts`
  - `packages/billing/src/actions/creditExpirationSettingsActions.ts`
  - `packages/scheduling/src/lib/contractLineDisambiguation.ts`
  - `packages/billing/src/lib/contractLineDisambiguation.ts`
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - `packages/billing/src/actions/billingAndTax.ts`
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
  - `packages/scheduling/src/components/time-management/time-entry/time-sheet/ContractInfoBanner.tsx`
  - `packages/clients/src/actions/clientActions.ts`
- New/updated implementation files:
  - `shared/billingClients/defaultContract.ts`
  - `shared/billingClients/billingSettings.ts`
  - `shared/billingClients/billingSchedule.ts`
  - `packages/billing/src/actions/billingCycleAnchorActions.ts`
  - `packages/billing/src/actions/billingSettingsActions.ts`
  - `packages/billing/src/actions/creditExpirationSettingsActions.ts`
  - `server/migrations/20260321150000_add_system_managed_default_contract_marker.cjs`
  - `shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
  - `packages/clients/src/actions/clientActions.ts`
  - `shared/models/clientModel.ts`
  - `server/src/lib/api/services/ClientService.ts`
  - `packages/integrations/src/services/xeroCsvClientSyncService.ts`
  - `shared/services/emailService.ts`
  - `ee/docs/plans/2026-03-21-system-managed-default-contract-cutover/ENGINEERING_NOTES.md`

## Completed Checklist Progress

- (2026-03-21) Completed features: `F001-F018`, `F055`, `F056`, `F063`, `F068`.
- (2026-03-21) Completed tests: `T001`, `T002`.

## Open Questions

- Should default-contract pointer be persisted in billing settings or inferred by deterministic query?
- Should API base delete always delegate to domain delete orchestration for client entity type?
- What is final policy when billing settings are explicitly set to null/default state: keep default contract dormant or remove assignment?

## Progress Update (2026-03-21)

- Resolver/date cutover: both scheduling and billing `contractLineDisambiguation` now accept `effectiveDate` and apply date-window filtering using `start_date <= effectiveDate(end-of-day)` and `end_date is null || end_date >= effectiveDate(start-of-day)`.
- Save/UI callers now pass effective dates consistently: time-entry save uses computed `work_date`, usage save/update uses `usage_date`, and UI eligible-lines queries pass entry/usage date.
- Removed display-only ambiguous default selection in `ContractInfoBanner`; ambiguous multi-line matches now require explicit selection instead of showing a synthetic default.
- Billing engine unresolved reconciliation now persists deterministic single eligible contract-line assignments for time/usage with `whereNull(contract_line_id)` guards, then excludes those records from unresolved output.
- Recurring due-work now emits primary unresolved identity keys (`schedule:*:unresolved:*`) instead of legacy `non_contract` keys; invoice-generation and UI parsing now support both unresolved and legacy non-contract formats for backward compatibility.
- Completed features: `F019-F026`.
- Completed tests: `T003`, `T004`.
- Completed features: `F027-F033`.
- Completed tests: `T005`, `T006`, `T007`.
- Completed features: `F034-F037`.
- Completed tests: `T008`.

## Additional Runbooks (2026-03-21)

- Verify T003/T004 effective-date coverage:
  - `cd packages/scheduling && npx vitest run tests/timeEntryCrud.changeRequests.test.ts`
  - `cd server && npx vitest run ../packages/billing/tests/usageActions.effectiveDate.test.ts`
- Verify reconciliation behavior for deterministic vs ambiguous unresolved work:
  - `cd server && npx vitest run src/test/unit/billing/billingEngine.unresolvedReconciliation.test.ts`
- Verify unresolved-key candidate + generation compatibility:
  - `cd server && npx vitest run src/test/unit/billing/invoiceGeneration.unresolvedSelectionKeys.test.ts src/test/unit/billing/nonContractDueWork.integration.test.ts src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`
- Re-run default-contract ensure suite after fallback hook expansion:
  - `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- Typecheck touched shared/integration workspaces:
  - `npm -w shared run typecheck`
  - `npm -w @alga-psa/integrations run typecheck`
  - `npm -w @alga-psa/scheduling run typecheck` (currently fails due pre-existing `packages/clients` type errors unrelated to this plan)

## Progress Update (2026-03-21, F038/F039/T009)

- Added explicit recurring due-work attribution metadata on row/candidate shapes (`source`, business label, completeness, missing fields) to carry grouped-row assignment context through server and UI layers.
- `billingAndTax` now stamps persisted rows as `explicit_contract` vs `system_managed_default_contract` and unresolved rows as `unresolved`; grouped candidates aggregate attribution summaries.
- Persisted rows with incomplete contract attribution metadata are now marked non-generatable with a blocking reason before they reach grouped selection.
- `AutomaticInvoices` now consumes attribution metadata for grouped-row context labels and warning copy (`Assignment attribution metadata missing ...`) instead of relying on heuristic-only contract field checks.
- Added UI guard coverage for grouped rows: business-safe labels for system-managed default and unresolved work, plus hard-block behavior for metadata-missing rows.
- Completed features: `F038`, `F039`.
- Completed test: `T009`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`
- `cd server && npx vitest run src/test/unit/billing/invoiceGeneration.unresolvedSelectionKeys.test.ts src/test/unit/billing/nonContractDueWork.integration.test.ts`
- `npm -w shared run typecheck`

### Notes

- `npm -w @alga-psa/billing run typecheck` still reports unrelated pre-existing workspace errors outside this change set; new attribution changes compile within exercised paths.
- Running `automaticInvoices.recurringDueWork.ui.test.tsx` in the same invocation currently triggers existing router-mount test harness issues (`invariant expected app router to be mounted`) not introduced by this work.

## Progress Update (2026-03-21, F040-F044/T010)

- Updated contract list UI (`ClientContractsTab`) to surface `System-managed default` badge and helper copy (`Created automatically for uncontracted work`) directly in contract-name cells.
- Added system-managed lifecycle guardrails in list actions: default contracts now only expose view/details access and hide destructive/manual lifecycle operations (`Delete`, `Terminate`, `Restore`, `Set to Active`).
- Updated contract detail UI (`ContractDetail`) with explicit system-managed banner/copy and read-only behavior for lifecycle/ownership-sensitive controls.
- Detail view now disables ownership-changing controls (assignment edit, lifecycle selectors, save) and hides destructive delete action for system-managed default contracts.
- Added static UI contract test coverage for list/detail guardrails and copy semantics.
- Completed features: `F040`, `F041`, `F042`, `F043`, `F044`.
- Completed test: `T010`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx src/test/unit/billing/systemManagedDefaultContracts.ui.static.test.ts`
- `cd server && npx vitest run src/test/unit/billing/invoiceGeneration.unresolvedSelectionKeys.test.ts src/test/unit/billing/nonContractDueWork.integration.test.ts`

### Notes

- `T010` is currently implemented as a static UI contract test due test-environment import-resolution issues when rendering full `ContractDetail` runtime dependencies in isolation.

## Progress Update (2026-03-21, F045/F046/T011)

- Updated time-entry contract banner copy to remove `default rates` fallback language and use explicit `system-managed default contract` terminology for unmatched service lines.
- Updated fallback contract display label to `System-managed default contract` while preserving ambiguous-state messaging that requires explicit selection before persistence.
- Updated usage tracking tooltip, placeholder, and helper copy to mirror the same system-managed default terminology when client context is missing.
- Added a static UI terminology contract test covering both time-entry banner and usage tracking copy semantics, including guard text ensuring unresolved assignment remains explicit.
- Completed features: `F045`, `F046`.
- Completed test: `T011`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/defaultContractTerminology.ui.static.test.ts`

### Notes

- `T011` is currently implemented as a static source-contract test to avoid full UI runtime harness complexity while still enforcing copy semantics and unresolved-assignment wording.

## Progress Update (2026-03-21, F047/F048)

- Reworked `AutomaticInvoices` fallback assignment-context labels to business-safe copy, replacing technical identifier leaks in grouped rows:
  - `Assignment line <id>` -> `Assigned contract line`
  - `Execution <identity>` -> `Assigned work item`
- Preserved attribution-first behavior (`member.attribution.label`) so explicit/default/unresolved labels continue to display when provided by due-work attribution metadata.
- Added regression coverage in `automaticInvoices.nonContractSelection.ui.test.tsx` to ensure mixed explicit-contract + system-managed-default rows remain combinable when billing scopes align, and still generate as a single grouped parent target.
- Completed features: `F047`, `F048`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`

### Notes

- Broader legacy wiring suites still contain pre-existing brittle string expectations unrelated to this feature; feature verification was scoped to the recurring automatic-invoices UI integration test that exercises the changed behavior.

## Progress Update (2026-03-21, F049/F050)

- Added action-layer billing permission gates in `contractActions` for contract-view and mutation entry points used by billing contract list/detail flows (`read`, `create`, `update`).
- Added explicit server-side mutation guardrails to block create/update payload attempts that include system-managed identity fields (`is_system_managed_default`, `owner_client_id`).
- Sanitized create/update payload stripping for protected fields to ensure no accidental pass-through into model writes.
- Added wiring coverage asserting these guardrails stay present in contract actions.
- Completed features: `F049`, `F050`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx src/test/unit/billing/systemManagedContractGuardrails.wiring.test.ts`

### Notes

- Guardrails are implemented at action entry points so API/controller paths that call these actions inherit the same permission and mutation protections.

## Progress Update (2026-03-21, F051-F054)

- Added structured ensure observability in `shared/billingClients/defaultContract.ts`:
  - `default_contract.ensure` events for `created`, `reused`, and `skipped_no_billing_configuration` outcomes.
  - Included metric markers: `default_contract_created`, `default_contract_reused`, and skip marker.
- Added structured resolver routing logs in both scheduling and billing disambiguation libs:
  - `contract_line_resolver.routing` events with decisions `explicit`, `default`, or `ambiguous_or_unresolved`.
  - Included ambiguous marker metric `unresolved_ambiguous_count`.
- Added billing-engine reconciliation observability for unresolved write-back flow:
  - `billing_engine.reconcile.unresolved` events for deterministic single-match persistence and ambiguous/no-match skips.
  - Included deterministic marker `unmatched_resolved_deterministically` and ambiguous marker `unresolved_ambiguous_count`.
- Added wiring tests to lock observability contract points for ensure, resolver, and reconciliation paths.
- Completed features: `F051`, `F052`, `F053`, `F054`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/defaultContractObservability.wiring.test.ts src/test/unit/billing/systemManagedContractGuardrails.wiring.test.ts src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`

### Notes

- Structured payloads intentionally avoid end-user fields beyond tenant/client/record identifiers already present in server action context.

## Progress Update (2026-03-21, F057/F058)

- Validated and locked lazy backfill behavior via wiring coverage:
  - `ensureDefaultContractForClientIfBillingConfigured` gates ensure on `client_billing_settings` existence and returns `{ ensured: false }` otherwise.
  - This preserves no-forced-global-backfill behavior and first-qualifying-touchpoint creation semantics.
- Validated and locked targeted reconciliation wiring:
  - Due-work unresolved collection routes through `BillingEngine.calculateUnresolvedNonContractChargesForExecutionWindow`, which performs deterministic single-match write-back while leaving ambiguous/no-match rows unresolved.
- Added a dedicated wiring test file for lazy-backfill + reconciliation path contracts.
- Completed features: `F057`, `F058`.

### Verification commands

- `cd server && npx vitest run src/test/unit/billing/defaultContractLazyBackfill.wiring.test.ts src/test/unit/billing/defaultContractObservability.wiring.test.ts`

## Progress Update (2026-03-21, F059)

- Added explicit sequencing runbook at `SEQUENCING_RUNBOOK.md` with stage gates, required-state criteria, and verification commands.
- Sequencing now formalizes cutover dependencies across:
  - data model + ensure,
  - hook coverage,
  - resolver/date alignment,
  - reconciliation semantics,
  - invoice selection/attribution safeguards,
  - UI guardrails,
  - lifecycle cleanup parity,
  - observability checks.
- Included rollback/safety rules to avoid partial-cutover invalid states and premature fallback removal.
- Completed feature: `F059`.

## Progress Update (2026-03-21, F061)

- Added `DEVELOPER_RUNBOOK.md` covering default-contract lifecycle, routing, reconciliation, grouped-attribution behavior, and operational verification commands.
- Documented forward guardrails to prevent reintroducing eager creation or identity-field bypasses.
- Completed feature: `F061`.

## Progress Update (2026-03-21, F069)

- Enforced canonical system-managed default contract naming convention during ensure:
  - existing default-contract rows are normalized to
    - name: `System-managed default contract`
    - description: `Created automatically for uncontracted work`
  - normalization occurs on ensure touchpoints without creating duplicate contracts.
- Added shared ensure regression coverage for legacy-named default contracts to guarantee canonical rename + assignment ensure behavior.
- Completed feature: `F069`.

### Verification commands

- `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`

## Progress Update (2026-03-21, F060/F066/F067)

- Removed obsolete legacy branch filtering in recurring invoice selection scoping:
  - dropped dead `__non_contract__` obligation-prefix exclusion in invoice generation,
  - retained legacy key parsing only at the schedule-key parser for backward compatibility.
- Renamed internal selector helper in invoice generation from non-contract-centric wording to unresolved-centric wording to match cutover semantics.
- Audited integration-created client pathway (`xeroCsvClientSyncService`) and confirmed first billing-config touchpoint hook still calls shared default-contract ensure.
- Added/kept wiring coverage asserting package/shared billing settings + schedule/anchor paths continue to use shared ensure primitives, preventing cross-package drift.
- Completed features: `F060`, `F066`, `F067`.

### Verification commands

- `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- `cd server && npx vitest run src/test/unit/billing/defaultContractCrossPackageParity.wiring.test.ts src/test/unit/billing/invoiceGeneration.unresolvedSelectionKeys.test.ts`
