# Scratchpad — EE Packages Relocation for Calendar and Teams

- Plan slug: `ee-packages-relocation-calendar-teams`
- Created: `2026-03-10`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-10) Scope only calendaring and Microsoft Teams enterprise code. Do not broaden this plan into a repo-wide `packages/ee` cleanup.
- (2026-03-10) Use two enterprise packages: `ee/packages/calendar` and `ee/packages/microsoft-teams`.
- (2026-03-10) Treat `packages/ee` as CE stubs and compatibility forwarders only for migrated domains after the move.
- (2026-03-10) Keep `ee/server/src/app/...` as thin Next entrypoints where needed, but move live implementation logic into enterprise packages.
- (2026-03-10) Keep shared Microsoft profile infrastructure out of scope unless a calendar or Teams package depends on a thin integration surface.
- (2026-03-10) Use package names `@alga-psa/ee-calendar` and `@alga-psa/ee-microsoft-teams` to avoid colliding with the existing shared `@alga-psa/teams` package while keeping the EE scope explicit.
- (2026-03-10) Keep shared wrappers on `@enterprise/*` for now where they already exist, but collapse the live implementation behind those wrappers into `ee/packages/*` so the compatibility layer stops owning runtime logic.
- (2026-03-10) Prefer direct `@alga-psa/ee-*` entrypoints for shared package wrappers and shared server helpers; keep `@enterprise/*` only on the CE/EE route-page delegator layer that must stay fail-closed in community builds.

## Discoveries / Constraints

- (2026-03-10) `tsconfig.base.json` maps `@enterprise` and `@ee` to `packages/ee/src`, which makes `packages/ee` the baseline alias source tree for the repo.
- (2026-03-10) `server/next.config.mjs` overrides `@ee` and `@enterprise` differently in EE builds, but current behavior still depends on the mixed `packages/ee` and `ee/server/src` layout.
- (2026-03-10) `server/vitest.config.ts` currently aliases `@ee` to `ee/server/src` and `@enterprise` to `packages/ee/src`, which is part of the drift problem.
- (2026-03-10) `ee/packages/workflows` already exists and is the clearest precedent for enterprise workspace package structure.
- (2026-03-10) There is already a shared `packages/teams` package, so the enterprise Teams package should not collide with that namespace.
- (2026-03-10) Current calendar and Teams EE code is split across `packages/ee/src`, `ee/server/src`, and shared packages importing `@enterprise/*`.
- (2026-03-10) Recent calendar and Teams EE-boundary work has already shown how easy it is for placeholder `packages/ee` files to accidentally become runtime targets.
- (2026-03-10) `ee/packages/calendar` can reuse most of the live calendar implementation from `packages/ee/src/lib/services/calendar/*` with minimal import surgery; the biggest package-level pathing gap was missing root `@/utils/*` aliases.
- (2026-03-10) `ee/packages/microsoft-teams` can reuse the existing `ee/server/src/lib/teams/*`, Teams actions, notification delivery, auth helpers, page, and route handlers almost verbatim because that tree already had internal relative imports.
- (2026-03-10) Nx project inference recognizes both new packages once they have `package.json` + `project.json`; `npx nx show project @alga-psa/ee-calendar` and `npx nx show project @alga-psa/ee-microsoft-teams` both returned valid project metadata and targets.
- (2026-03-10) `ee/server` route files and Teams helper files can be reduced to simple package forwarders without breaking the existing CE/EE dynamic delegator pattern under `server/src/app/...`.
- (2026-03-10) The last shared calendar runtime links that still touched the legacy enterprise alias were `server/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts` and `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`; retargeting them to `@alga-psa/ee-calendar/event-bus` and `@alga-psa/ee-calendar/jobs` removes `packages/ee` from that runtime path.
- (2026-03-10) A dedicated relocation audit contract in `server/src/test/unit/packaging/eePackagesRelocationAudit.contract.test.ts` now covers shared wrapper ownership, CE stub reduction, alias/fail-closed config, import-audit cleanup, and scope guard expectations for the moved domains.

## Commands / Runbooks

- (2026-03-10) Inspect current stub/live split:
  - `find packages/ee/src -type f | sort | rg "calendar|teams"`
  - `find ee/server/src -type f | sort | rg "calendar|teams"`
- (2026-03-10) Inspect aliasing:
  - `rg -n "@enterprise|@ee" tsconfig.base.json server/tsconfig.json server/next.config.mjs server/vitest.config.ts packages -g '!node_modules'`
- (2026-03-10) Validate finished plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-10-ee-packages-relocation-calendar-teams`
- (2026-03-10) Validate new EE package typecheck targets:
  - `npx tsc -p ee/packages/calendar/tsconfig.json --noEmit`
  - `npx tsc -p ee/packages/microsoft-teams/tsconfig.json --noEmit`
- (2026-03-10) Validate server typecheck after rewiring:
  - `npx tsc -p server/tsconfig.json --noEmit`
- (2026-03-10) Validate route/delegator/runtime contract coverage after relocation:
  - `cd server && npx vitest run --config vitest.config.ts src/test/unit/packaging/eePackagesRelocation.contract.test.ts src/test/unit/calendar/calendarRuntimeOwnership.contract.test.ts src/test/unit/api/calendarCallbackRoutes.delegator.test.ts src/test/unit/api/calendarWebhookRoutes.delegator.test.ts src/test/unit/api/teamsRoutes.delegator.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts`
- (2026-03-10) Validate shared-wrapper, alias, and CE-guard relocation coverage:
  - `cd server && npx vitest run --config vitest.config.ts src/test/unit/calendar/calendarSyncSubscriber.delegator.test.ts src/test/unit/jobs/calendarWebhookMaintenanceHandler.delegator.test.ts src/test/unit/calendar/calendarActions.ceBoundary.test.ts src/test/unit/packaging/eePackagesRelocation.contract.test.ts src/test/unit/packaging/eePackagesRelocationAudit.contract.test.ts`
- (2026-03-10) Validate the broader relocation-sensitive route, component, action, and notification suites:
  - `cd server && npx vitest run --config vitest.config.ts src/test/unit/api/calendarCallbackRoutes.delegator.test.ts src/test/unit/api/calendarWebhookRoutes.delegator.test.ts src/test/unit/api/teamsRoutes.delegator.test.ts src/test/unit/app/teams/tab/page.delegator.test.tsx src/test/unit/components/integrations/IntegrationsSettingsPage.calendar.test.tsx src/test/unit/components/integrations/IntegrationsSettingsPage.teams.test.tsx src/test/unit/components/profile/UserProfile.calendar.contract.test.ts src/test/unit/internal-notifications/teamsNotificationDelivery.wrapper.test.ts src/test/unit/calendar/calendarRuntimeOwnership.contract.test.ts src/test/unit/calendar/calendarMigrationOwnership.contract.test.ts src/test/unit/calendar/calendarActions.ee.contract.test.ts src/test/unit/lib/teams/teamsRuntimeOwnership.contract.test.ts src/test/unit/calendar/calendarSyncSubscriber.delegator.test.ts src/test/unit/jobs/calendarWebhookMaintenanceHandler.delegator.test.ts src/test/unit/calendar/calendarActions.ceBoundary.test.ts src/test/unit/packaging/eePackagesRelocation.contract.test.ts src/test/unit/packaging/eePackagesRelocationAudit.contract.test.ts`
- (2026-03-10) Validate Nx project graph visibility:
  - `npx nx show project @alga-psa/ee-calendar`
  - `npx nx show project @alga-psa/ee-microsoft-teams`

## Links / References

- Prior plan: `ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration`
- Prior plan: `ee/docs/plans/2026-03-09-calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
- Precedent package: `ee/packages/workflows`
- Current alias roots:
  - `tsconfig.base.json`
  - `server/tsconfig.json`
  - `server/next.config.mjs`
  - `server/vitest.config.ts`
- Current mixed EE sources:
  - `packages/ee/src/...calendar...`
  - `packages/ee/src/...teams...`
  - `ee/server/src/...calendar...`
  - `ee/server/src/...teams...`
- New live package roots:
  - `ee/packages/calendar/src`
  - `ee/packages/microsoft-teams/src`

## Open Questions

- Should migrated calendar and Teams imports continue to support `@enterprise/*` compatibility paths long term, or should the package move also retire those paths for the migrated domains?
- The package names are now `@alga-psa/ee-calendar` and `@alga-psa/ee-microsoft-teams`; the remaining open question is how aggressively to retire the remaining shared `server/src/app/...` `@enterprise/*` delegator imports versus leaving them as long-lived facades over the new package surfaces.
