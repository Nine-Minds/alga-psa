# Scratchpad — Entra Settings Guided Flow Layout

- Plan slug: `entra-settings-guided-flow-layout`
- Created: `2026-02-20`

## What This Is

Focused planning log for guided-layout improvements in Entra integration settings. Scope is intentionally limited to UX flow clarity and minimal behavior wiring.

## Decisions

- (2026-02-20) Use a new focused plan folder instead of extending the phase-1 mega-plan, to keep scope concise and reviewable.
- (2026-02-20) Design direction approved: single-page guided step controller (not new route, not accordion).
- (2026-02-20) Progression model is hard-gated: only current-step onboarding action is primary/actionable.
- (2026-02-20) Test strategy will be light: add only focused UI-state tests and rely on existing Entra tests for broad regressions.
- (2026-02-20) Approved UX direction includes an explicit post-initial-sync maintenance mode (operations-first layout), not just onboarding cleanup.

## Discoveries / Constraints

- (2026-02-20) Existing settings UI currently presents `Run Discovery`, `Run Initial Sync`, and `Sync All Tenants Now` side by side.
- (2026-02-20) `discoverEntraManagedTenants` action already exists and is permission/flag-gated.
- (2026-02-20) `startEntraSync` supports `scope: 'initial'` and `scope: 'all-tenants'`.
- (2026-02-20) Mapping progress can be derived from existing signals in status + mapping summary (`lastDiscoveryAt`, `mappedTenantCount`).
- (2026-02-20) Step 3 (Map) confirmation behavior currently lives in `EntraTenantMappingTable`.
- (2026-02-20) Existing sync history action/panel (`getEntraSyncRunHistory` / `EntraSyncHistoryPanel`) can provide a mode-switch signal without new schema work.

## Commands / Runbooks

- (2026-02-20) Scaffold plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Entra Settings Guided Flow Layout" --slug entra-settings-guided-flow-layout`

## Links / References

- Existing phase-1 plan baseline:
  - `ee/docs/plans/2026-02-20-entra-integration-phase-1/PRD.md`
  - `ee/docs/plans/2026-02-20-entra-integration-phase-1/features.json`
  - `ee/docs/plans/2026-02-20-entra-integration-phase-1/tests.json`
- Primary UI target:
  - `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`
- Existing actions:
  - `packages/integrations/src/actions/integrations/entraActions.ts`

## Open Questions

- Should Step 3 include a dedicated top-level CTA (`Review Mappings`) that scrolls/focuses the table, or should copy-only guidance be used?
- Should mapping confirmation continue to optionally start initial sync from table flow, or should guided Step 4 become the single canonical trigger?
- In maintenance mode, should `Run Discovery` be a visible secondary action by default or placed behind a details/overflow affordance?

## Execution Log

- (2026-02-20) F001 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Added explicit guided-step derivation helper (`deriveGuidedStepState`) with `connect|discover|map|sync` current-step output.
  - Step derivation now uses existing status signals plus mapping summary via `mappedTenantCount = max(status.mappedTenantCount, mappingSummary.mapped)`.
  - Rationale: deterministic step progression based only on existing UI-loaded state, no API/schema changes.

## Gotchas

- Running `npm -w sebastian-ee run test:unit -- src/__tests__/unit/entraIntegrationSettings.initialSyncCta.test.tsx` still executes the full unit suite because of the workspace script shape; several unrelated baseline tests fail in this worktree due missing `@enterprise/*` resolution and pre-existing duplicated-render test issues.
- (2026-02-20) F002 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Added computed per-step visual state (`current`, `complete`, `locked`) based on guided-step index.
  - Step cards now show explicit status labels in the progress header while preserving existing step descriptions.
- (2026-02-20) F003 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Added `Current Step` card that renders one onboarding primary action at a time (`connect` guidance, `Run Discovery`, `Review Mappings`, or `Run Initial Sync`).
  - Removed discovery/initial actions from the old shared action row, leaving no same-tier onboarding multi-action group.
- (2026-02-20) Post-F003 targeted settings test run now fails in old assertions that expected always-visible `Run Initial Sync`; this is expected and will be resolved by F011/T00x guided-flow test updates.
- (2026-02-20) F004 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Added explicit current-step booleans and gated onboarding action rendering to current step only.
  - Added guard in connection-option click handler to no-op if Connect is not the active step.
- (2026-02-20) F005 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Wired guided `Run Discovery` CTA to `discoverEntraManagedTenants`.
  - Added discovery loading state and feedback message (`#entra-run-discovery-feedback`).
  - On success, refreshes status and bumps mapping table refresh key so mapping context updates immediately.
- (2026-02-20) F006 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Wired guided `Run Initial Sync` CTA to `startEntraSync({ scope: 'initial' })`.
  - Added initial-sync loading and feedback state (`#entra-run-initial-sync-feedback`) and status refresh after start.
- (2026-02-20) F007 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Moved `Sync All Tenants Now` into a dedicated `Ongoing Operations` panel (`#entra-ongoing-operations-panel`).
  - Preserved existing enable/disable logic, action wiring, and feedback message behavior.
- (2026-02-20) F008 implemented in `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx`.
  - Added explicit Step 3 heading and instructional mapping guidance copy above `EntraTenantMappingTable`.
  - Added current-step cue text when map phase is active; kept `EntraTenantMappingTable` wiring unchanged to avoid behavior regression.
- (2026-02-20) Mapping table unit test `src/__tests__/unit/entraTenantMappingTable.selection.test.tsx` has a pre-existing flaky assertion (`getByText('Unmapped Import Tenant')`) that now collides with same text in picker options; failure is unrelated to F008 logic (table internals unchanged).
- (2026-02-20) F009 validated/implemented.
  - Status diagnostics block (`#entra-connection-status-panel`) was preserved intact across layout refactor, including CIPP server and direct tenant/credential-source rows.
  - Existing Refresh and Disconnect controls remained in place and unchanged.
  - Validation check: `cd ee/server && npx vitest run src/__tests__/unit/entraIntegrationSettings.initialSyncCta.test.tsx -t "T121|T132"`.
