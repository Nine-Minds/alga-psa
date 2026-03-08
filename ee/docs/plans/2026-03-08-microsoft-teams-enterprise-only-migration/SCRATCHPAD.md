# Scratchpad — Microsoft Teams Enterprise-Only Migration

- Plan slug: `microsoft-teams-enterprise-only-migration`
- Created: `2026-03-08`

## What This Is

Follow-on scratchpad for moving Microsoft Teams from shared/CE ownership to EE-only ownership without changing the already-planned Teams v1 product shape.

Prefer short bullets. Append new entries as the migration progresses and revise earlier notes if decisions change.

## Decisions

- (2026-03-08) This is a new follow-on ALGA plan, not a rewrite of `2026-03-07-microsoft-teams-integration-v1`.
- (2026-03-08) Teams must be strict EE-only; CE should not expose active Teams UI or runtime behavior.
- (2026-03-08) Teams admin UI moves from `Integrations -> Providers` to `Integrations -> Communication`.
- (2026-03-08) Teams UI and runtime are both gated by enterprise edition plus the tenant feature flag `teams-integration-ui`.
- (2026-03-08) Shared Microsoft profiles remain shared because they support email, calendar, and MSP SSO in addition to Teams.
- (2026-03-08) Teams-specific schema moves to `ee/server/migrations`.
- (2026-03-08) Existing local/dev Teams data is disposable; no production-style backfill path is required.
- (2026-03-08) The Entra CE-stub plus EE-delegation pattern is the precedent for Teams route and settings ownership.
- (2026-03-08) Use one availability helper for settings, routes, actions, and notification delivery to avoid drift.

## Discoveries / Constraints

- (2026-03-08) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` currently renders `TeamsIntegrationSettings` directly inside the shared `Providers` category.
- (2026-03-08) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` already uses `useFeatureFlag('entra-integration-ui')` as a precedent for tenant-flag-driven settings visibility.
- (2026-03-08) `packages/integrations/src/actions/integrations/entraActions.ts` already uses `isFeatureFlagEnabled(...)` server-side as a precedent for tenant-flag-driven enterprise behavior.
- (2026-03-08) `server/src/app/api/integrations/entra/route.ts` plus `_ceStub.ts` show the preferred CE-wrapper plus EE-import pattern for public enterprise routes.
- (2026-03-08) The current Teams implementation is spread across shared integrations, shared auth, shared notifications, shared routes, and shared migrations, so the extraction must be coordinated rather than file-local.
- (2026-03-08) The original Teams v1 plan already contains many `implemented: true` features, which is why a follow-on migration plan is cleaner than rewriting history.
- (2026-03-08) The current Teams plan folder already lives at `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/` and should remain intact for historical traceability.
- (2026-03-08) The feature-flag registry already has enterprise-specific flags such as `entra-integration-ui`, so `teams-integration-ui` fits the existing pattern.
- (2026-03-08) `packages/integrations/src/actions/integrations/teamsActions.ts` and `packages/integrations/src/actions/integrations/teamsPackageActions.ts` are still shared server-action entrypoints for Teams settings/runtime/package behavior, so they need shared CE-safe gating before any deeper EE extraction.
- (2026-03-08) `server/src/app/teams/tab/page.tsx`, `server/src/app/api/teams/bot/messages/route.ts`, `server/src/app/api/teams/message-extension/query/route.ts`, `server/src/app/api/teams/quick-actions/route.ts`, and the three `server/src/app/api/teams/auth/callback/*/route.ts` files are still active shared runtime entrypoints; none has a Teams-specific EE delegator yet.
- (2026-03-08) `packages/notifications/src/realtime/teamsNotificationDelivery.ts` and `packages/notifications/src/realtime/internalNotificationBroadcaster.ts` remain shared notification entrypoints for Teams delivery and still need EE-boundary work.
- (2026-03-08) `server/src/lib/teams/handleTeamsAuthCallback.ts`, `server/src/lib/teams/resolveTeamsTabAuthState.ts`, `server/src/lib/teams/actions/teamsActionRegistry.ts`, `server/src/lib/teams/bot/teamsBotHandler.ts`, and `server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts` remain shared concrete runtime modules with no existing Teams EE twin.
- (2026-03-08) `@enterprise/*` resolves to `packages/ee/src/*` stubs in the shared/server test context, so new Teams route boundary work must add both `packages/ee/src/app/...` stubs and `ee/server/src/app/...` real EE files to match the existing Entra packaging pattern.
- (2026-03-08) The current message-extension public route is a single endpoint at `server/src/app/api/teams/message-extension/query/route.ts`; it handles both `composeExtension/query` and `composeExtension/submitAction`, so one EE delegator covers both search and action traffic.

## Progress

- (2026-03-08) Completed planning checklist `F001-F010` and `T001-T020`: added executable plan-contract coverage in `server/src/test/unit/docs/teamsEnterpriseOnlyMigrationPlan.contract.test.ts` and re-ran the ALGA plan validator so the migration folder, historical reference, shared-profile framing, rollout flag, fresh-install targets, and stable IDs are all machine-checked.
- (2026-03-08) Completed availability/settings checklist `F011-F014`, `F016`, `F018-F021`, `F025-F029`, `F031-F041`, `F048-F049`, `F051`, `F174-F175`, plus test coverage for the implemented subset: added shared helper `packages/integrations/src/lib/teamsAvailability.ts`, wired Teams settings/actions through it, moved the Teams settings surface from `Providers` to `Communication`, and added targeted contract tests for helper behavior, action gating, and settings placement.
- (2026-03-08) Reused the same availability helper in client settings code by allowing the settings wrapper to skip tenant-context enforcement while still using the canonical EE-plus-flag rule. Rationale: the UI hook already evaluates tenant-scoped flags, while route/action runtime still requires explicit tenant context and keeps the `tenant_not_configured` state distinct.
- (2026-03-08) Completed route-boundary checklist `F015`, `F023-F024`, `F030`, `F055-F072`, `F078`, `F080`, `F082-F083`, and `F176`: shared Teams tab/API files now only delegate, CE returns explicit 501-unavailable responses, EE flag-off returns explicit disabled responses, the concrete tab page now lives at `ee/server/src/app/teams/tab/page.tsx`, and shared request/auth handlers now call the shared Teams availability helper before continuing when tenant context can be resolved.

## Commands / Runbooks

- (2026-03-08) Scaffolded this plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Microsoft Teams Enterprise-Only Migration" --slug microsoft-teams-enterprise-only-migration`
- (2026-03-08) Useful code-reading commands while implementing:
  - `sed -n '1,240p' packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
  - `sed -n '1,240p' packages/integrations/src/actions/integrations/entraActions.ts`
  - `sed -n '1,240p' server/src/app/api/integrations/entra/route.ts`
  - `sed -n '1,240p' server/src/app/api/integrations/entra/_ceStub.ts`
- (2026-03-08) Validate this plan folder with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration`
- (2026-03-08) Recommended verification slices once implementation starts:
  - settings visibility tests for CE vs EE flag-off vs EE flag-on
  - Teams route wrapper tests for unavailable, disabled, and delegated cases
  - Teams action wrapper tests for unavailable, disabled, and delegated cases
  - migration tests for fresh CE vs fresh EE schema
- (2026-03-08) Availability/settings verification commands:
  - `pnpm vitest run --coverage.enabled false ../packages/integrations/src/lib/teamsAvailability.test.ts ../packages/integrations/src/actions/integrations/teamsActions.test.ts ../packages/integrations/src/actions/integrations/teamsPackageActions.test.ts ../packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts src/test/unit/components/integrations/IntegrationsSettingsPage.teams.test.tsx`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false src/test/unit/docs/teamsEnterpriseOnlyMigrationPlan.contract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration`
- (2026-03-08) Route-boundary verification commands:
  - `pnpm vitest run --coverage.enabled false ../packages/integrations/src/lib/teamsAvailability.test.ts src/test/unit/api/teamsRoutes.delegator.test.ts src/test/unit/app/teams/tab/page.delegator.test.tsx src/test/unit/app/teams/tab/page.test.tsx`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false src/app/api/teams/bot/messages/route.test.ts src/app/api/teams/message-extension/query/route.test.ts src/app/api/teams/quick-actions/route.test.ts src/app/api/teams/auth/callback/bot/route.test.ts src/app/api/teams/auth/callback/message-extension/route.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/bot/teamsBotHandler.test.ts src/test/unit/lib/teams/quickActions/teamsQuickActionHandler.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`

## Links / References

- Original Teams v1 plan:
  - `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/PRD.md`
  - `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/features.json`
  - `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/tests.json`
- Current shared settings composition:
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- Entra EE precedent:
  - `packages/integrations/src/actions/integrations/entraActions.ts`
  - `server/src/app/api/integrations/entra/route.ts`
  - `server/src/app/api/integrations/entra/_ceStub.ts`
- Teams route-boundary split:
  - `server/src/app/teams/tab/page.tsx`
  - `ee/server/src/app/teams/tab/page.tsx`
  - `server/src/app/api/teams/_ceStub.ts`
  - `server/src/test/unit/api/teamsRoutes.delegator.test.ts`
- Shared feature-flag registry:
  - `packages/core/src/lib/features.ts`

## Open Questions

- None at plan-creation time. The migration shape is decision-complete enough to begin implementation.
