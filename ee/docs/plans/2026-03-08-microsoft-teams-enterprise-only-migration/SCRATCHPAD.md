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
- (2026-03-08) Shared Teams schema migrations are deleted rather than tombstoned; fresh CE installs stop before creating Teams tables, while fresh EE installs add the Teams tables by layering the EE migration files on top of shared history.
- (2026-03-08) The Entra CE-stub plus EE-delegation pattern is the precedent for Teams route and settings ownership.
- (2026-03-08) Use one availability helper for settings, routes, actions, and notification delivery to avoid drift.
- (2026-03-08) Canonical unavailable copy for CE wrappers: `Microsoft Teams integration is only available in Enterprise Edition.`
- (2026-03-08) Canonical disabled copy for EE flag-off wrappers: `Microsoft Teams integration is disabled for this tenant.`

## Discoveries / Constraints

- (2026-03-08) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` currently renders `TeamsIntegrationSettings` directly inside the shared `Providers` category.
- (2026-03-08) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` already uses `useFeatureFlag('entra-integration-ui')` as a precedent for tenant-flag-driven settings visibility.
- (2026-03-08) `packages/integrations/src/actions/integrations/entraActions.ts` already uses `isFeatureFlagEnabled(...)` server-side as a precedent for tenant-flag-driven enterprise behavior.
- (2026-03-08) `server/src/app/api/integrations/entra/route.ts` plus `_ceStub.ts` show the preferred CE-wrapper plus EE-import pattern for public enterprise routes.
- (2026-03-08) The current Teams implementation is spread across shared integrations, shared auth, shared notifications, shared routes, and shared migrations, so the extraction must be coordinated rather than file-local.
- (2026-03-08) The original Teams v1 plan already contains many `implemented: true` features, which is why a follow-on migration plan is cleaner than rewriting history.
- (2026-03-08) The current Teams plan folder already lives at `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/` and should remain intact for historical traceability.
- (2026-03-08) The feature-flag registry already has enterprise-specific flags such as `entra-integration-ui`, so `teams-integration-ui` fits the existing pattern.
- (2026-03-08) Concrete Teams bot, message-extension, quick-action, tenant-context, and auth-callback helpers now live under `ee/server/src/lib/teams/*`; the old shared `server/src/lib/teams/*` concrete runtime files were removed so the shared tree no longer owns those business paths.
- (2026-03-08) Vitest in the server workspace does not resolve `ee/server/src/...` as a bare specifier, so the EE route/page modules now use relative imports into `ee/server/src/lib/teams/*` and the ownership tests import those files by relative path.
- (2026-03-08) `server/src/lib/teams/actions/teamsActionRegistry.ts` moved to `ee/server/src/lib/teams/actions/teamsActionRegistry.ts`; the EE bot, quick-action, and message-extension handlers now import the EE registry directly.
- (2026-03-08) `packages/integrations/src/actions/integrations/teamsPackageActions.ts` is now a shared wrapper that gates with `getTeamsAvailability(...)` and delegates into `ee/server/src/lib/actions/integrations/teamsPackageActions.ts`, leaving concrete manifest/package logic under EE while preserving the shared action signature.
- (2026-03-08) The old shared `packages/integrations/src/actions/integrations/teamsPackageShared.ts` deep-link helper only had EE-owned callers, so it was removed and replaced with `ee/server/src/lib/teams/teamsDeepLinks.ts`; notification delivery, package manifest/status code, the action registry, and the message-extension handler now all use the EE helper directly.
- (2026-03-08) `packages/integrations/src/actions/integrations/teamsActions.ts` is now a shared wrapper that only checks availability and delegates into `ee/server/src/lib/actions/integrations/teamsActions.ts`; the concrete Teams settings persistence, profile validation, and execution-state reads now live under EE.
- (2026-03-08) The first wrapper rewrite accidentally dropped `getTeamsIntegrationExecutionState`, and the existing bot/message-extension/action-registry tests did not catch it because they mock the shared action module. A direct execution-state test was added to `packages/integrations/src/actions/integrations/teamsActions.test.ts` to prevent future wrapper regressions of that kind.
- (2026-03-08) `packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts` is now a shared fail-closed wrapper that delegates into `ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts`; the old shared resolver used by Teams tab auth/runtime now lives under EE, while shared `@alga-psa/auth` exports remain stable.
- (2026-03-08) `server/src/lib/teams/buildTeamsReauthUrl.ts` moved to `ee/server/src/lib/teams/buildTeamsReauthUrl.ts` because it is only used by Teams auth-callback surfaces; `ee/server/src/lib/teams/handleTeamsAuthCallback.ts` now imports the EE helper directly.
- (2026-03-08) `server/src/lib/teams/resolveTeamsLinkedUser.ts`, `server/src/lib/teams/buildTeamsFullPsaUrl.ts`, `server/src/lib/teams/resolveTeamsTabDestination.ts`, and `server/src/lib/teams/resolveTeamsTabAccessState.ts` were still shared Teams-only helpers after the first EE route split. They now live under `ee/server/src/lib/teams/*`, and the EE tab page plus action registry import the EE copies directly.
- (2026-03-08) Shared Teams schema ownership now stops at Microsoft profile infrastructure: `server/migrations/20260307153000_create_teams_integrations.cjs` and `server/migrations/20260307193000_add_teams_package_metadata.cjs` were removed, and the same filenames now live under `ee/server/migrations/`.
- (2026-03-08) The schema ownership integration test cannot execute copied migrations from `/tmp` because some migrations rely on package resolution and source-relative asset reads. The final harness builds a merged EE migration directory out of symlinked migration files so the original module and asset paths still resolve.
- (2026-03-08) Fresh-schema validation now runs against actual migrated databases: CE uses shared migrations only, while EE uses shared migrations plus only the two Teams EE migration files. This avoids unrelated EE-only platform prerequisites like `vector` while still proving the Teams ownership boundary.
- (2026-03-08) Developers with pre-migration local databases should reset or recreate their local DBs instead of trying to preserve old shared Teams tables. The new contract is fresh-install ownership, not an in-place backfill for unreleased Teams data.
- (2026-03-08) The EE ownership contract now explicitly asserts three non-obvious boundaries: concrete Teams runtime files live under `ee/server`, Microsoft profile CRUD/settings remain shared-only with no EE duplicate implementation, and the Teams runtime still binds through `teams_integrations.selected_profile_id` back to shared `microsoft_profiles` instead of inventing a second credential model.
- (2026-03-08) Shared CE route delegators now explicitly cover Teams quick-action POSTs plus bot/message-extension auth callback GETs, so CE returns the standard EE-only payload and EE delegates those routes without touching Teams runtime logic in shared code.
- (2026-03-08) The shared notification broadcaster remains the source of truth for the existing Redis in-app channel and passes the same internal-notification payload into the Teams delivery wrapper as an additional channel, rather than creating a Teams-specific notification generation path.
- (2026-03-08) Shared Teams action/package response types now live in `packages/integrations/src/actions/integrations/teamsContracts.ts` instead of the shared `use server` wrappers. Rationale: EE implementations can import the neutral contracts file without recursively importing wrapper modules that themselves lazy-load EE code.
- (2026-03-08) `ee/server/src/lib/actions/integrations/teamsActions.ts` now imports the shared `TEAMS_*` constants from `teamsShared.ts` instead of duplicating them locally. Rationale: one canonical enum/value source reduces drift across settings UI, shared wrappers, and EE runtime validation.
- (2026-03-08) Final cleanup/compatibility coverage is source-contract heavy rather than behavior-heavy because the remaining work was proving boundaries: wrapper-only barrels, no direct EE imports in shared auth/notification code, no stale shared Teams settings component, and unchanged Microsoft CRUD/binding behavior across CE and EE.
- (2026-03-08) `packages/integrations/src/actions/integrations/teamsActions.ts` and `packages/integrations/src/actions/integrations/teamsPackageActions.ts` are still shared server-action entrypoints for Teams settings/runtime/package behavior, so they need shared CE-safe gating before any deeper EE extraction.
- (2026-03-08) `server/src/app/teams/tab/page.tsx`, `server/src/app/api/teams/bot/messages/route.ts`, `server/src/app/api/teams/message-extension/query/route.ts`, `server/src/app/api/teams/quick-actions/route.ts`, and the three `server/src/app/api/teams/auth/callback/*/route.ts` files are still active shared runtime entrypoints; none has a Teams-specific EE delegator yet.
- (2026-03-08) `packages/notifications/src/realtime/internalNotificationBroadcaster.ts` remains the shared notification fan-out entrypoint, but `packages/notifications/src/realtime/teamsNotificationDelivery.ts` is now only a shared availability-gated wrapper that delegates into `ee/server/src/lib/notifications/teamsNotificationDelivery.ts`.
- (2026-03-08) `server/src/lib/teams/handleTeamsAuthCallback.ts`, `server/src/lib/teams/resolveTeamsTabAuthState.ts`, `server/src/lib/teams/actions/teamsActionRegistry.ts`, `server/src/lib/teams/bot/teamsBotHandler.ts`, and `server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts` remain shared concrete runtime modules with no existing Teams EE twin.
- (2026-03-08) `@enterprise/*` resolves to `packages/ee/src/*` stubs in the shared/server test context, so new Teams route boundary work must add both `packages/ee/src/app/...` stubs and `ee/server/src/app/...` real EE files to match the existing Entra packaging pattern.
- (2026-03-08) The current message-extension public route is a single endpoint at `server/src/app/api/teams/message-extension/query/route.ts`; it handles both `composeExtension/query` and `composeExtension/submitAction`, so one EE delegator covers both search and action traffic.

## Progress

- (2026-03-08) Completed planning checklist `F001-F010` and `T001-T020`: added executable plan-contract coverage in `server/src/test/unit/docs/teamsEnterpriseOnlyMigrationPlan.contract.test.ts` and re-ran the ALGA plan validator so the migration folder, historical reference, shared-profile framing, rollout flag, fresh-install targets, and stable IDs are all machine-checked.
- (2026-03-08) Completed availability/settings checklist `F011-F014`, `F016`, `F018-F021`, `F025-F029`, `F031-F041`, `F048-F049`, `F051`, `F174-F175`, plus test coverage for the implemented subset: added shared helper `packages/integrations/src/lib/teamsAvailability.ts`, wired Teams settings/actions through it, moved the Teams settings surface from `Providers` to `Communication`, and added targeted contract tests for helper behavior, action gating, and settings placement.
- (2026-03-08) Reused the same availability helper in client settings code by allowing the settings wrapper to skip tenant-context enforcement while still using the canonical EE-plus-flag rule. Rationale: the UI hook already evaluates tenant-scoped flags, while route/action runtime still requires explicit tenant context and keeps the `tenant_not_configured` state distinct.
- (2026-03-08) Completed route-boundary checklist `F015`, `F023-F024`, `F030`, `F055-F072`, `F078`, `F080`, `F082-F083`, and `F176`: shared Teams tab/API files now only delegate, CE returns explicit 501-unavailable responses, EE flag-off returns explicit disabled responses, the concrete tab page now lives at `ee/server/src/app/teams/tab/page.tsx`, and shared request/auth handlers now call the shared Teams availability helper before continuing when tenant context can be resolved.
- (2026-03-08) Completed notification-gating checklist `F017`, `F143-F144`: `packages/notifications/src/realtime/teamsNotificationDelivery.ts` now calls the shared Teams availability helper with tenant/user context before any Teams Graph or package-link work, so CE and EE-flag-off tenants short-circuit with skipped delivery results instead of attempting Teams delivery runtime.
- (2026-03-08) Completed notification-ownership checklist `F091`, `F142`, `F145-F147`, `F152` and tests `T181`, `T283-T284`, `T289`, `T291`, `T303-T304`, `T438`: concrete Teams activity-feed delivery and category/deep-link composition now live in `ee/server/src/lib/notifications/teamsNotificationDelivery.ts`, while the shared wrapper only checks availability, caches a dynamic EE import, and returns a stable `delivery_unavailable` skip when the EE implementation cannot be loaded.
- (2026-03-08) Added wrapper-level tests for notification delegation/import failure plus broadcaster coverage that Redis in-app delivery still succeeds when Teams EE delivery is unavailable. Rationale: the migration needs bounded EE import failures to fail closed without breaking the broader notification path.
- (2026-03-08) Completed deep-link ownership checklist `F092`, `F148` and tests `T183`, `T295-T296`: all Teams personal-tab/bot/message-extension deep-link composition now lives in `ee/server/src/lib/teams/teamsDeepLinks.ts`, and the notification guard tests still verify the EE deep-link helper is not touched when CE or EE-flag-off availability blocks runtime execution.
- (2026-03-08) Completed Teams settings-action ownership checklist `F096-F097`, `F112-F114`, `F127-F128`, `F131` and tests `T191-T192`, `T223-T228`, `T253-T256`, `T261-T262`: shared Teams settings actions now follow the same availability-gated EE delegator pattern as package actions, while the EE implementation retains tenant-admin permission enforcement, shared Microsoft profile readiness usage, and the `getTeamsIntegrationExecutionState(...)` read path used by the EE bot/message-extension/action registry.
- (2026-03-08) Completed Teams auth-helper ownership checklist `F124`, `F132`, `F137-F138` and tests `T263-T276`: Teams-only Microsoft profile resolution and Teams-only reauth URL composition now live under EE, while the shared auth export path remains a fail-closed wrapper so `nextAuthOptions` and `resolveTeamsTabAuthState` keep using stable shared interfaces without carrying concrete Teams runtime logic in CE.
- (2026-03-08) Completed helper/runtime cleanup checklist `F098-F099`, `F134-F136`, `F179` and tests `T195-T198`, `T267-T272`, `T357-T358`: EE Teams runtime now keeps using shared notification payload/broadcast infrastructure plus shared auth/session primitives, while Teams-only linked-user, tab-destination, full-PSA-link, and tab-access helpers were moved out of shared `server/src/lib/teams/*` into `ee/server/src/lib/teams/*` without changing MSP-user, tenant-match, or selected-profile enforcement.
- (2026-03-08) Chose the optional disabled-shell variant for settings `F022`/`F038`: `TeamsEnterpriseIntegrationSettings` now renders a non-active Communication-card placeholder in EE when the tenant flag is off instead of rendering nothing, while CE still renders no Teams surface at all.
- (2026-03-08) Moved the concrete Teams settings UI into `ee/server/src/components/settings/integrations/TeamsIntegrationSettings.tsx` and deleted the shared `packages/integrations` copy. Rationale: shared settings composition now imports an EE-owned implementation through the existing `@enterprise/components/...` boundary, while `packages/ee` remains a null CE stub.
- (2026-03-08) The EE-owned Teams settings UI continues to use the shared Microsoft profile selector/status data instead of duplicating client ID, tenant ID, or secret entry fields. Rationale: Microsoft profiles remain shared infrastructure even though the Teams surface moved into EE ownership.
- (2026-03-08) Preserved tenant-admin-only Teams setup semantics while moving the UI into EE. Rationale: the client-side settings contract still exercises the tenant-admin setup surface, and the shared Teams settings actions continue to reject non-admin or client-portal callers with `Forbidden`.
- (2026-03-08) Retained CE-addressable Teams stubs only for public route boundaries that external clients may call: `/api/teams/bot/messages`, `/api/teams/message-extension/query`, `/api/teams/quick-actions`, `/api/teams/auth/callback/tab`, `/api/teams/auth/callback/bot`, `/api/teams/auth/callback/message-extension`, and `/api/teams/package`. The personal tab UI at `/teams/tab` remains a hard-stop page when Teams is unavailable instead of executing Teams runtime behavior.
- (2026-03-08) Added a shared Teams EE-route loader in `server/src/app/api/teams/_eeDelegator.ts` so public route wrappers now share cached dynamic imports, bounded import-failure logging, and stable `OPTIONS` responses. Rationale: route wrappers now follow one delegator pattern instead of repeating route-local import/error logic.

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
- (2026-03-08) Validate schema ownership with:
  - `pnpm vitest run --coverage.enabled false src/test/unit/migrations/teamsIntegrationsMigration.test.ts src/test/unit/migrations/teamsPackageMetadataMigration.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `DB_PORT=55433 pnpm vitest run --coverage.enabled false src/test/integration/teamsMigrationOwnership.integration.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
- (2026-03-08) Validate EE ownership/package boundaries with:
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/api/teamsRoutes.delegator.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `../../node_modules/.bin/vitest run --coverage.enabled false src/actions/integrations/teamsPackageActions.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/packages/integrations`
- (2026-03-08) Validate auth and notification wrapper behavior with:
  - `pnpm vitest run --coverage.enabled false src/test/unit/api/teamsRoutes.delegator.test.ts src/test/unit/lib/teams/quickActions/teamsQuickActionHandler.test.ts src/test/unit/internal-notifications/internalNotificationBroadcaster.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/nextAuthOptions.mspContract.test.ts src/lib/sso/teamsMicrosoftProviderResolution.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/packages/auth`
- (2026-03-08) Final boundary/compatibility validation runs:
  - `../../node_modules/.bin/vitest run --coverage.enabled false src/lib/teamsAvailability.test.ts src/actions/integrations/microsoftActions.test.ts src/actions/integrations/microsoftConsumerBindings.test.ts src/actions/integrations/teamsActions.test.ts src/actions/integrations/teamsPackageActions.test.ts src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/packages/integrations`
  - `DB_PORT=55433 pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/api/teamsRoutes.delegator.test.ts src/test/unit/components/integrations/IntegrationsSettingsPage.teams.test.tsx src/test/unit/components/integrations/TeamsIntegrationSettings.contract.test.tsx src/test/unit/internal-notifications/internalNotificationBroadcaster.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.wrapper.test.ts src/test/unit/docs/teamsEnterpriseOnlyMigrationPlan.contract.test.ts src/test/integration/teamsMigrationOwnership.integration.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/nextAuthOptions.mspContract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/packages/auth`
- (2026-03-08) Recommended verification slices once implementation starts:
  - settings visibility tests for CE vs EE flag-off vs EE flag-on
  - Teams route wrapper tests for unavailable, disabled, and delegated cases
  - Teams action wrapper tests for unavailable, disabled, and delegated cases
  - migration tests for fresh CE vs fresh EE schema
- (2026-03-08) Verified EE runtime ownership move with:
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/lib/teams/bot/teamsBotHandler.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts src/test/unit/lib/teams/quickActions/teamsQuickActionHandler.test.ts src/test/unit/lib/teams/resolveTeamsTabAuthState.test.ts src/test/unit/app/teams/tab/page.test.tsx src/app/api/teams/bot/messages/route.test.ts src/app/api/teams/message-extension/query/route.test.ts src/app/api/teams/quick-actions/route.test.ts src/app/api/teams/auth/callback/bot/route.test.ts src/app/api/teams/auth/callback/message-extension/route.test.ts`
- (2026-03-08) Verified Teams package/action-registry EE delegation with:
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/lib/teams/actions/teamsActionRegistry.test.ts src/test/unit/lib/teams/bot/teamsBotHandler.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts src/test/unit/lib/teams/quickActions/teamsQuickActionHandler.test.ts ../packages/integrations/src/actions/integrations/teamsPackageActions.test.ts src/app/api/teams/package/route.test.ts src/test/unit/components/integrations/TeamsIntegrationSettings.contract.test.tsx`
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
  - `pnpm vitest run --coverage.enabled false ../packages/integrations/src/lib/teamsAvailability.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
- (2026-03-08) Notification-boundary verification commands:
  - `pnpm vitest run --coverage.enabled false src/test/unit/internal-notifications/teamsNotificationDelivery.wrapper.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts src/test/unit/internal-notifications/internalNotificationBroadcaster.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false ../packages/integrations/src/actions/integrations/teamsPackageActions.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts src/test/unit/lib/teams/actions/teamsActionRegistry.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false ../packages/integrations/src/actions/integrations/teamsActions.test.ts src/test/unit/components/integrations/TeamsIntegrationSettings.contract.test.tsx src/test/unit/lib/teams/bot/teamsBotHandler.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts src/test/unit/lib/teams/actions/teamsActionRegistry.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/sso/teamsMicrosoftProviderResolution.test.ts src/lib/nextAuthOptions.mspContract.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/packages/auth`
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/resolveTeamsTabAuthState.test.ts src/test/unit/lib/teams/buildTeamsReauthUrl.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/app/api/teams/auth/callback/bot/route.test.ts src/app/api/teams/auth/callback/message-extension/route.test.ts`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/buildTeamsFullPsaUrl.test.ts src/test/unit/lib/teams/resolveTeamsTabDestination.test.ts src/test/unit/lib/teams/resolveTeamsTabAccessState.test.ts src/test/unit/lib/teams/resolveTeamsLinkedUser.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/lib/teams/actions/teamsActionRegistry.test.ts src/test/unit/app/teams/tab/page.test.tsx`
    Run from `/Users/roberisaacs/alga-psa.worktrees/feature/teams-integration/server`
  - `pnpm vitest run --coverage.enabled false src/test/unit/lib/teams/resolveTeamsLinkedUser.test.ts src/test/unit/lib/teams/resolveTeamsTabAuthState.test.ts src/test/unit/lib/teams/resolveTeamsTabAccessState.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts src/test/unit/internal-notifications/internalNotificationBroadcaster.test.ts`
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
- Teams notification gating:
  - `packages/notifications/src/realtime/teamsNotificationDelivery.ts`
  - `ee/server/src/lib/notifications/teamsNotificationDelivery.ts`
  - `ee/server/src/lib/teams/teamsDeepLinks.ts`
  - `server/src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts`
  - `server/src/test/unit/internal-notifications/teamsNotificationDelivery.wrapper.test.ts`
- Teams schema ownership split:
  - `server/test-utils/dbConfig.ts`
  - `server/src/test/unit/migrations/teamsIntegrationsMigration.test.ts`
  - `server/src/test/unit/migrations/teamsPackageMetadataMigration.test.ts`
  - `server/src/test/integration/teamsMigrationOwnership.integration.test.ts`
  - `ee/server/migrations/20260307153000_create_teams_integrations.cjs`
  - `ee/server/migrations/20260307193000_add_teams_package_metadata.cjs`
- Shared feature-flag registry:
  - `packages/core/src/lib/features.ts`

## Open Questions

- None at plan-creation time. The migration shape is decision-complete enough to begin implementation.
