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

## Discoveries / Constraints

- Billing settings ensure/insert logic is duplicated across shared and package layers, so hooks must be centralized or replicated safely.
- Some client create flows bypass package-level actions (integration/email/import), so client-create hook alone is insufficient.
- API generic delete path may bypass domain cleanup used by package client delete action.
- Resolver behavior currently differs by path and can use current-time filtering instead of effective-date filtering.
- Billing engine can treat some null-assigned rows as resolvable without persisting assignment; this feeds due-work ambiguity.
- UI copy has technical/non-business labels that do not communicate default-contract behavior clearly.
- Existing package wiring tests include brittle source-string assertions for exact function signatures/throw style; those tests can fail even when runtime behavior is unchanged.
- Shared vitest config only discovers `services/**/*.test.ts` and `**/__tests__/**/*.test.ts`, so shared tests for this plan need to live under `shared/__tests__/`.

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
  - `ee/docs/plans/2026-03-21-system-managed-default-contract-cutover/ENGINEERING_NOTES.md`

## Completed Checklist Progress

- (2026-03-21) Completed features: `F001-F013`, `F055`, `F056`, `F063`.
- (2026-03-21) Completed tests: `T001`, `T002`.

## Open Questions

- Should default-contract pointer be persisted in billing settings or inferred by deterministic query?
- Should API base delete always delegate to domain delete orchestration for client entity type?
- What is final policy when billing settings are explicitly set to null/default state: keep default contract dormant or remove assignment?
