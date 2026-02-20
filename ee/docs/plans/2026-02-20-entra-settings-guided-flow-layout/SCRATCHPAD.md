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
