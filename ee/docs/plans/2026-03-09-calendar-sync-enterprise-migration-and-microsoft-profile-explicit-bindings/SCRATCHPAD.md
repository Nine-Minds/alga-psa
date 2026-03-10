# Scratchpad — Calendar Sync Enterprise Migration and Microsoft Profile Explicit Bindings

- Plan slug: `calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
- Created: `2026-03-09`

## What This Is

Follow-on implementation notes for moving calendar sync to EE-only ownership and finishing the Microsoft profile explicit-binding cleanup.

## Decisions

- (2026-03-09) Calendar sync moves to EE end to end, including integration settings, user-profile calendar settings, OAuth callbacks, runtime services, webhook maintenance, and subscriber execution.
- (2026-03-09) Shared Microsoft profile storage remains shared infrastructure; this plan does not create a second EE-only Microsoft credential model.
- (2026-03-09) CE Microsoft profile UX should describe and bind only MSP SSO.
- (2026-03-09) EE Microsoft profile UX should expose MSP SSO plus email, calendar, and Teams consumers.
- (2026-03-09) Explicit consumer bindings are the source of truth; legacy compatibility/default-consumer wording should be removed from the target design.
- (2026-03-09) CE keeps only stub or wrapper entrypoints where route or import boundaries require them, following the existing Entra and Teams EE patterns.
- (2026-03-09) The Entra and Teams CE-stub plus EE-delegation pattern is the precedent for calendar route wrappers: stable shared URL, `501` JSON in CE, dynamic EE delegation in enterprise.
- (2026-03-09) Canonical unavailable copy for calendar HTTP stubs should be `Calendar sync is only available in Enterprise Edition.` so CE fails clearly before any token exchange, provider write, or sync side effect.
- (2026-03-09) One edition-aware consumer matrix should drive both UI visibility and action-layer enforcement: CE shows only `msp_sso`; EE shows `msp_sso`, `email`, `calendar`, and `teams`.

## Discoveries / Constraints

- (2026-03-09) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` currently renders Calendar as a shared category and renders `MicrosoftIntegrationSettings` directly under `Providers`.
- (2026-03-09) `server/src/components/settings/profile/UserProfile.tsx` currently renders a `Calendar` tab through `CalendarIntegrationsSettings`, so the EE move has to include profile settings, not just admin settings.
- (2026-03-09) Shared calendar callback routes currently live at `server/src/app/api/auth/google/calendar/callback/route.ts` and `server/src/app/api/auth/microsoft/calendar/callback/route.ts`.
- (2026-03-09) Shared calendar runtime code exists in both `server/src/services/calendar/*` and `packages/integrations/src/services/calendar/*`, so the extraction needs an ownership pass across settings, service exports, adapters, and maintenance jobs.
- (2026-03-09) `packages/integrations/src/actions/integrations/microsoftActions.ts` still contains legacy compatibility semantics such as `LEGACY_MICROSOFT_PROFILE_CONSUMERS`, compatibility backfill logic, default-profile copy, and fallback-based consumer resolution.
- (2026-03-09) `MicrosoftIntegrationSettings.tsx` still contains the legacy Microsoft consumers pane and default-compatibility copy even though the binding table and binding actions already exist.
- (2026-03-09) The current binding table is shared at `server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs`, and Teams already depends on `selected_profile_id` plus binding-aware resolution.
- (2026-03-09) There are no screenshots checked into `ee/docs` for this plan folder or nearby migration docs, so the documentation cleanup for Calendar ownership is entirely text and runbook based.
- (2026-03-09) Calendar public entry routes also include `server/src/app/api/calendar/webhooks/google/route.ts` and `server/src/app/api/calendar/webhooks/microsoft/route.ts`, so webhook maintenance has to follow the same CE stub or EE delegator rule as OAuth callbacks.
- (2026-03-09) Shared auth/runtime precedent already exists for Microsoft consumers:
  - `packages/auth/src/lib/sso/mspSsoResolution.ts`
  - `packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts`
  - `ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts`
- (2026-03-09) Existing doc-contract precedent lives at `server/src/test/unit/docs/teamsEnterpriseOnlyMigrationPlan.contract.test.ts`, which is the right pattern for validating this plan folder as it evolves.

## Commands / Runbooks

- (2026-03-09) Scaffold plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Calendar Sync Enterprise Migration and Microsoft Profile Explicit Bindings" --slug calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
- (2026-03-09) Validate plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-09-calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
- (2026-03-09) Useful discovery queries:
  - `rg -n "CalendarIntegrationsSettings|CalendarSyncService|CalendarProviderService|microsoft_profile_consumer_bindings|LEGACY_MICROSOFT_PROFILE_CONSUMERS|MicrosoftIntegrationSettings" packages server ee`
  - `rg -n "api/auth/.*/calendar/callback|teams|msp_sso" server packages ee`
- (2026-03-09) Focused validation suites expected for this migration:
  - settings/profile visibility tests for CE versus EE calendar entrypoints
  - calendar callback and webhook wrapper tests for unavailable versus delegated behavior
  - Microsoft profile UI contract tests for CE-only MSP SSO versus EE consumer visibility
  - Microsoft binding action tests for edition visibility, tenant scoping, archive guards, and fallback removal
  - ownership/package-boundary tests for shared wrapper imports versus EE runtime modules
  - migration/documentation contract tests for shared binding schema and this plan folder
- (2026-03-09) Latest validator result:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-09-calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
  - Result: valid (`216` features, `432` tests)
- (2026-03-09) Focused implementation checks for the calendar visibility slice:
  - `pnpm vitest run --coverage.enabled=false src/test/unit/components/integrations/IntegrationsSettingsPage.calendar.test.tsx src/test/unit/components/profile/UserProfile.calendar.contract.test.ts ../packages/integrations/src/lib/calendarAvailability.test.ts`
  - `pnpm vitest run --coverage.enabled=false src/test/unit/components/integrations/IntegrationsSettingsPage.teams.test.tsx`
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-09) Focused implementation checks for the calendar callback delegator slice:
  - `pnpm vitest run --coverage.enabled=false src/test/unit/api/calendarCallbackRoutes.delegator.test.ts`
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-09) Focused implementation checks for the calendar webhook delegator slice:
  - `pnpm vitest run --coverage.enabled=false src/test/unit/api/calendarWebhookRoutes.delegator.test.ts src/test/unit/api/calendarCallbackRoutes.delegator.test.ts`
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-09) Focused implementation checks for the calendar maintenance delegator slice:
  - `pnpm vitest run --coverage.enabled=false src/test/unit/api/calendarCallbackRoutes.delegator.test.ts src/test/unit/api/calendarWebhookRoutes.delegator.test.ts src/test/unit/jobs/calendarWebhookMaintenanceHandler.delegator.test.ts`
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`

## Links / References

- Prior Microsoft profile and Teams plan:
  - `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/`
- Prior Teams EE-boundary follow-on plan:
  - `ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration/`
- Current shared settings composition:
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- Current shared Microsoft profile UI:
  - `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx`
- Current shared Microsoft actions:
  - `packages/integrations/src/actions/integrations/microsoftActions.ts`
- Current shared profile page:
  - `server/src/components/settings/profile/UserProfile.tsx`
- Current shared calendar callback routes:
  - `server/src/app/api/auth/google/calendar/callback/route.ts`
  - `server/src/app/api/auth/microsoft/calendar/callback/route.ts`
- Current EE-owned calendar entrypoints after the first two migration slices:
  - `packages/integrations/src/components/settings/integrations/CalendarEnterpriseIntegrationSettings.tsx`
  - `@enterprise/components/settings/profile/CalendarProfileSettings`
  - `ee/server/src/app/api/auth/google/calendar/callback/route.ts`
  - `ee/server/src/app/api/auth/microsoft/calendar/callback/route.ts`
- Current shared calendar webhook routes:
  - `server/src/app/api/calendar/webhooks/google/route.ts`
  - `server/src/app/api/calendar/webhooks/microsoft/route.ts`
- Current shared Teams/Entra EE-boundary precedent:
  - `server/src/app/api/teams/_ceStub.ts`
  - `server/src/app/api/teams/_eeDelegator.ts`
  - `server/src/app/api/integrations/entra/_ceStub.ts`
  - `server/src/test/unit/api/teamsRoutes.delegator.test.ts`
  - `server/src/test/unit/api/entraRoutes.delegator.test.ts`

## Open Questions

- (2026-03-09) If Outlook inbound email remains CE-supported long term, decide whether its explicit Microsoft binding should stay EE-only in provider UI or move to a consumer-owned CE surface later. The current plan assumes the Microsoft profile page itself shows only MSP SSO in CE.

## Calendar EE Move Inventory

- Settings composition:
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
  - `packages/integrations/src/components/calendar/CalendarIntegrationsSettings.tsx`
  - `packages/integrations/src/components/calendar/index.ts`
- User profile surface:
  - `server/src/components/settings/profile/UserProfile.tsx`
- Shared route wrappers that must become CE stubs or EE delegators:
  - `server/src/app/api/auth/google/calendar/callback/route.ts`
  - `server/src/app/api/auth/microsoft/calendar/callback/route.ts`
  - `server/src/app/api/calendar/webhooks/google/route.ts`
  - `server/src/app/api/calendar/webhooks/microsoft/route.ts`
- Calendar callback delegator helpers and EE-owned route files added for the second migration slice:
  - `server/src/app/api/auth/calendar/_ceStub.ts`
  - `server/src/app/api/auth/calendar/_eeDelegator.ts`
  - `packages/ee/src/app/api/auth/google/calendar/callback/route.ts`
  - `packages/ee/src/app/api/auth/microsoft/calendar/callback/route.ts`
  - `ee/server/src/app/api/auth/google/calendar/callback/route.ts`
  - `ee/server/src/app/api/auth/microsoft/calendar/callback/route.ts`
- Calendar webhook delegator helpers and EE-owned route files added for the third migration slice:
  - `server/src/app/api/calendar/_ceStub.ts`
  - `server/src/app/api/calendar/_eeDelegator.ts`
  - `packages/ee/src/app/api/calendar/webhooks/google/route.ts`
  - `packages/ee/src/app/api/calendar/webhooks/microsoft/route.ts`
  - `ee/server/src/app/api/calendar/webhooks/google/route.ts`
  - `ee/server/src/app/api/calendar/webhooks/microsoft/route.ts`
- Calendar maintenance handler boundary added for the fourth migration slice:
  - `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`
  - `packages/ee/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`
- Calendar UI visibility and EE-entry helpers added for the first migration slice:
  - `packages/integrations/src/lib/calendarAvailability.ts`
  - `packages/integrations/src/components/settings/integrations/CalendarEnterpriseIntegrationSettings.tsx`
  - `packages/ee/src/components/settings/integrations/CalendarIntegrationsSettings.tsx`
  - `ee/server/src/components/settings/integrations/CalendarIntegrationsSettings.tsx`
  - `packages/ee/src/components/settings/profile/CalendarProfileSettings.tsx`
  - `ee/server/src/components/settings/profile/CalendarProfileSettings.tsx`
- Shared actions and runtime code that currently own live behavior:
  - `packages/integrations/src/actions/calendarActions.ts`
  - `packages/integrations/src/services/calendar/CalendarProviderService.ts`
  - `packages/integrations/src/services/calendar/CalendarSyncService.ts`
  - `packages/integrations/src/services/calendar/CalendarWebhookProcessor.ts`
  - `packages/integrations/src/services/calendar/CalendarWebhookMaintenanceService.ts`
  - `packages/integrations/src/services/calendar/providers/GoogleCalendarAdapter.ts`
  - `packages/integrations/src/services/calendar/providers/MicrosoftCalendarAdapter.ts`
  - `packages/integrations/src/services/calendar/providers/base/BaseCalendarAdapter.ts`
- Server runtime ownership hotspots that must stop executing in CE:
  - `server/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts`
  - `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`
  - `server/src/services/CalendarProviderService.ts`
  - `server/src/services/CalendarSyncService.ts`
  - `server/src/services/calendar/CalendarProviderService.ts`
  - `server/src/services/calendar/CalendarSyncService.ts`
  - `server/src/services/calendar/CalendarWebhookMaintenanceService.ts`
  - `server/src/services/calendar/CalendarWebhookProcessor.ts`
- Existing tests that should evolve with the EE cutover:
  - `server/src/test/integration/calendar/manualSync.integration.test.ts`
  - `server/src/test/integration/calendar/scheduleAutoSync.integration.test.ts`
  - `server/src/test/integration/calendar/webhookProcessing.integration.test.ts`
  - `server/src/test/unit/calendar/calendarActions.sync.test.ts`
  - `server/src/test/unit/api/calendarCallbackRoutes.delegator.test.ts`
  - `server/src/test/unit/api/calendarWebhookRoutes.delegator.test.ts`
  - `server/src/test/unit/jobs/calendarWebhookMaintenanceHandler.delegator.test.ts`

## Microsoft Binding Cleanup Inventory

- Shared UI and contracts:
  - `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx`
  - `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.contract.test.tsx`
- Shared action and helper layer:
  - `packages/integrations/src/actions/integrations/microsoftActions.ts`
  - `packages/integrations/src/actions/integrations/microsoftActions.test.ts`
  - `packages/integrations/src/actions/integrations/mspSsoDomainActions.ts`
- Shared auth/runtime consumers that must stay binding-driven:
  - `packages/auth/src/lib/sso/mspSsoResolution.ts`
  - `packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts`
  - `server/src/app/api/auth/msp/sso/discover/route.ts`
  - `server/src/app/api/auth/msp/sso/resolve/route.ts`
  - `ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts`
- Shared schema and migration coverage:
  - `server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs`
  - `server/src/test/unit/migrations/microsoftConsumerBindingsMigration.test.ts`

## Unsupported Edge States / Manual Cleanup

- Tenants with an active Microsoft calendar provider but no explicit `calendar` binding should be backfilled or rebound during migration; the steady-state runtime should not silently fall back to `is_default`.
- Tenants with archived Microsoft profiles still bound to active consumers should hit archive/delete guards until the binding is reassigned or cleared.
- If Outlook email temporarily retains fallback behavior, that fallback must stay isolated and documented as migration-only cleanup work instead of appearing in CE provider UX.

## Review Checklists

- CE review checklist:
  - No Calendar category remains visible in `Settings -> Integrations`.
  - No Calendar tab remains visible in `Profile`.
  - Calendar callback and webhook URLs fail clearly with enterprise-only behavior instead of partially executing.
  - Microsoft profile UI shows only MSP SSO-oriented copy and one binding control.
- EE review checklist:
  - Calendar settings remain fully configurable from `Settings -> Integrations -> Calendar`.
  - Profile `Calendar` tab remains functional.
  - Calendar callback and webhook URLs delegate to EE implementations and preserve current success/error behavior.
  - Microsoft profile UI shows MSP SSO, Email, Calendar, and Teams consumer controls.
- Regression checklist:
  - Teams EE cleanup remains intact; no shared Teams runtime is reintroduced.
  - MSP SSO discovery and resolve flows still use shared Microsoft profile infrastructure.
  - Email binding strategy is explicit and not left to compatibility-default assumptions.
  - Archive/delete guards still block profiles that remain actively bound.
  - Shared wrappers do not import EE files via raw filesystem-relative paths.
- Final acceptance checklist:
  - CE has no live calendar UI or runtime behavior.
  - EE retains complete calendar settings, profile, callback, webhook, and runtime behavior.
  - Microsoft consumer selection is binding-driven and edition-aware.
  - The legacy Microsoft consumers pane and default-compatibility wording are gone.

## Working Log

- (2026-03-09) Strengthened the PRD with explicit continuation references to the 2026-03-07 Microsoft/Teams plan and the 2026-03-08 Teams EE-only migration plan.
- (2026-03-09) Added calendar and Microsoft edition-contract matrices, CE stub/EE delegation rules, stable route commitments, intentional deletions, and a final acceptance matrix.
- (2026-03-09) Expanded the scratchpad with file inventories, focused validation suites, unsupported-edge-state notes, and CE/EE/regression review checklists so the migration can proceed without reopening scope discovery.
- (2026-03-09) Implemented the first calendar UI ownership slice:
  - added `calendarAvailability.ts` as the shared edition-aware source for Calendar category/tab visibility and fallback resolution,
  - moved settings Calendar rendering behind `CalendarEnterpriseIntegrationSettings`,
  - moved profile Calendar rendering behind `@enterprise/components/settings/profile/CalendarProfileSettings`,
  - removed CE Calendar discovery from settings navigation and profile tabs while preserving EE deep-link behavior.
- (2026-03-09) Updated the CE `packages/ee` Calendar settings/profile stubs to return explicit enterprise-only messaging when those wrappers are imported directly, while keeping the normal CE navigation surfaces hidden.
- (2026-03-09) Added focused tests for CE/EE Calendar visibility:
  - helper tests for category/tab resolution,
  - `IntegrationsSettingsPage.calendar.test.tsx` for CE hiding and EE visibility/provider copy,
  - `UserProfile.calendar.contract.test.ts` for the profile EE wrapper boundary.
- (2026-03-09) Implemented the calendar OAuth callback ownership slice:
  - moved the live Google and Microsoft calendar callback handlers to `ee/server/src/app/api/auth/.../calendar/callback/route.ts`,
  - replaced the shared callback files with CE stubs plus EE delegators,
  - added `packages/ee` callback stubs so CE builds remain import-safe,
  - kept the public callback URLs stable while removing live callback imports from shared route wrappers.
- (2026-03-09) Added `calendarCallbackRoutes.delegator.test.ts` to verify:
  - CE returns enterprise-only payloads,
  - EE delegates the original `Request` object to the EE route handlers,
  - shared callback wrappers no longer import `CalendarProviderService`, adapters, or OAuth-state logic directly.
- (2026-03-09) Updated the written migration artifacts to treat Calendar as an EE-owned surface consistently:
  - no checked-in screenshots needed refresh,
  - the PRD/checklists describe Calendar as EE-only,
  - the runbook references now point to the EE-owned settings/profile/callback entrypoints instead of a shared Calendar surface.
- (2026-03-09) Implemented the calendar webhook route ownership slice:
  - moved the live Google and Microsoft webhook handlers to `ee/server/src/app/api/calendar/webhooks/.../route.ts`,
  - replaced the shared webhook route files with CE stubs plus EE delegators,
  - added `packages/ee` webhook stubs so CE builds remain import-safe,
  - kept the public webhook URLs stable while removing shared re-exports of live webhook handlers.
- (2026-03-09) Extended the route-contract tests to verify:
  - CE webhook routes fail clearly with enterprise-only responses,
  - EE webhook routes delegate GET/POST/OPTIONS to EE handlers,
  - callback tests still cover CE unavailable behavior, EE delegation, and malformed callback input through the EE implementations.
- (2026-03-09) Confirmed middleware/auth handling has no calendar-callback-specific CE feature wiring:
  - callback URLs still flow through the generic `/api/auth/*` boundary,
  - webhook URLs remain explicitly unauthenticated for stable external delivery,
  - the shared route files no longer advertise live calendar webhook codepaths as CE-owned behavior.
- (2026-03-09) Moved the calendar webhook maintenance job entrypoint behind an edition-safe wrapper:
  - shared `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts` now no-ops in CE and lazy-loads the EE implementation,
  - live maintenance logic now resides in `packages/ee/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`,
  - focused tests verify CE no-op behavior, EE delegation, and removal of direct maintenance-service imports from the shared handler wrapper.
- (2026-03-09) The route runbook references now cover the full current EE ownership chain for calendar network entrypoints:
  - callback wrappers delegate to `ee/server/src/app/api/auth/.../calendar/callback/route.ts`,
  - webhook wrappers delegate to `ee/server/src/app/api/calendar/webhooks/.../route.ts`,
  - maintenance job entrypoints delegate through `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts` into `packages/ee/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`.
- (2026-03-09) Confirmed the Calendar settings UI boundary remains stable:
  - `IntegrationsSettingsPage.tsx` renders `CalendarEnterpriseIntegrationSettings`,
  - `CalendarEnterpriseIntegrationSettings.tsx` dynamically imports `@enterprise/components/settings/integrations/CalendarIntegrationsSettings`,
  - the shared settings composition no longer imports the concrete Calendar UI directly.
