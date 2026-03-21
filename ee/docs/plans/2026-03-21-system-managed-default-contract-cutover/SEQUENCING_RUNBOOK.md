# System-Managed Default Contract Cutover Sequencing Runbook

This runbook defines the required execution order for the cutover and the explicit gates that must pass before moving to the next stage.

## Stage 1: Data Model + Ensure Primitive

Required state:
- Default-contract identity marker and uniqueness guarantees are live.
- `ensureDefaultContractForClient` is idempotent and concurrency-safe.

Gate checks:
- `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- Ensure no duplicate `contracts.is_system_managed_default=true` rows per `(tenant, owner_client_id)`.

## Stage 2: Ensure Hooks on Billing Configuration Touchpoints

Required state:
- Shared/package billing settings/schedule/cycle-anchor paths call ensure hooks.
- Null-setting override/deletion flows do not eagerly recreate default contracts.

Gate checks:
- Billing settings/schedule update integration tests for create/update/delete paths.
- Manual smoke: update billing settings with and without active config and verify ensure behavior.

## Stage 3: Effective-Date Resolver Alignment

Required state:
- Scheduling and billing disambiguation resolve by effective date.
- Save paths + UI eligible-lines path use the same effective-date semantics.

Gate checks:
- `cd packages/scheduling && npx vitest run tests/timeEntryCrud.changeRequests.test.ts`
- `cd server && npx vitest run ../packages/billing/tests/usageActions.effectiveDate.test.ts`

## Stage 4: Reconciliation + Due-Work Semantics

Required state:
- Deterministic single-match unresolved rows are written back to source records.
- Ambiguous/no-match rows remain unresolved.
- Due-work output excludes deterministic rows after write-back.

Gate checks:
- `cd server && npx vitest run src/test/unit/billing/billingEngine.unresolvedReconciliation.test.ts`
- `cd server && npx vitest run src/test/unit/billing/nonContractDueWork.integration.test.ts`

## Stage 5: Invoice Selection + Grouped Attribution Safety

Required state:
- Recurring selection keys no longer depend on primary-path legacy non-contract fallback semantics.
- Grouped rows include attribution metadata and hard-block generation on missing attribution.

Gate checks:
- `cd server && npx vitest run src/test/unit/billing/invoiceGeneration.unresolvedSelectionKeys.test.ts`
- `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`

## Stage 6: UI Semantics + Guardrails

Required state:
- Contract list/detail and time/usage messaging use system-managed default terminology.
- System-managed contract destructive/lifecycle controls are constrained.

Gate checks:
- `cd server && npx vitest run src/test/unit/billing/systemManagedDefaultContracts.ui.static.test.ts`
- `cd server && npx vitest run src/test/unit/billing/defaultContractTerminology.ui.static.test.ts`

## Stage 7: Lifecycle Cleanup + API Path Parity

Required state:
- Package and API delete paths both remove default-contract assignment artifacts.
- No dangling references remain after client/billing-config cleanup.

Gate checks:
- Lifecycle integration tests for package delete and API/controller delete paths.
- Post-delete DB verification query for orphaned default-contract references.

## Stage 8: Observability + Operational Markers

Required state:
- Ensure/reconcile/route paths emit structured logs.
- Operational markers for created/reused/deterministic-resolved/ambiguous are present.

Gate checks:
- `cd server && npx vitest run src/test/unit/billing/defaultContractObservability.wiring.test.ts`
- Validate log payloads in lower env traces for expected event names.

## Rollback / Safety Rules

- Do not remove compatibility parsing until Stage 5 gates pass in CI and staging.
- If Stage 4 reconciliation introduces ambiguous-growth regressions, disable grouped generation for affected candidates and re-run Stage 4 diagnostics.
- Keep default-contract ensure lazy (billing-config touchpoint only) during rollout; do not introduce eager global backfill.
