# Scratchpad

- User selected no backfill: existing tier-entitled tenants do not automatically receive add-on rows.
- Existing AI add-on infrastructure uses `tenant_addons`, session `addons`, `TierContext.hasAddOn`, `assertAddOnAccess`, and Stripe metadata `addon_key`.
- Key files identified:
  - `packages/types/src/constants/addOns.ts`
  - `server/src/context/TierContext.tsx`
  - `server/src/components/settings/SettingsPage.tsx`
  - `ee/server/src/app/api/integrations/entra/_guards.ts`
  - `ee/packages/microsoft-teams/src/lib/teams/teamsAvailability.ts`
  - `ee/server/src/lib/stripe/StripeService.ts`
  - `ee/server/src/components/settings/account/AccountManagement.tsx`

## Implementation notes
- Added `ADD_ONS.TEAMS = 'teams'` and `ADD_ONS.ENTERPRISE = 'enterprise'`.
- Made `ENTRA_SYNC` and `TEAMS_INTEGRATION` add-on-only for tier utilities by excluding them from derived tier maps and returning false from `tierHasFeature`.
- Settings now computes Entra access from `hasAddOn(ADD_ONS.ENTERPRISE)` and Teams access from `hasAddOn(ADD_ONS.TEAMS)`.
- Entra API guard keeps the base `INTEGRATIONS` check and now also calls `assertAddOnAccess(ADD_ONS.ENTERPRISE)`.
- Teams runtime availability and Teams notification delivery check the active `teams` add-on row.
- Stripe add-on price lookup now supports AI, Teams, and Enterprise add-ons via monthly/annual env vars.
- Account Management renders all three add-ons through one generic purchase/cancel card flow.

## Validation
- Attempted focused Vitest run with `pnpm exec vitest run ...`; startup failed before tests because the repo-local Vitest config imports `dotenv`, but this checkout has no local `node_modules`/`dotenv` available.

- Added Enterprise add-on filtering to Entra recurring Temporal schedule setup so scheduled syncs are deleted/skipped when the add-on is inactive.
- Reviewer found the Teams Microsoft-provider binding bypass; fixed by hiding Teams consumer UI unless `canUseTeams` is true and by rejecting `setMicrosoftConsumerBinding({ consumerType: 'teams' })` without an active Teams add-on.
- Added missing package dependencies for new `@alga-psa/types` runtime imports in `ee/packages/microsoft-teams` and `ee/temporal-workflows`; refreshed `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- `pnpm exec tsc --noEmit --pretty false --skipLibCheck` completed successfully.
- Focused Vitest initially could not start without local dependencies; after wiring/installing dependencies, the focused Teams/add-on regression set passed:
  - `../packages/integrations/src/lib/teamsAvailability.test.ts`
  - `src/test/unit/teamsMeetingHelpers.test.ts`
  - `src/test/unit/internal-notifications/teamsNotificationDelivery.test.ts`
  - `../packages/integrations/src/actions/integrations/teamsActions.test.ts`
  - `../packages/integrations/src/actions/integrations/teamsPackageActions.test.ts`
  - `../packages/integrations/src/actions/integrations/microsoftActions.test.ts`
  - `../packages/scheduling/tests/availabilitySettingsActions.permission.test.ts`
- `cd server && npx tsc --noEmit --pretty false --project tsconfig.json` completed successfully.
