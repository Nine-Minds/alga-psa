# Scratchpad — Microsoft Entra Integration Phase 1

- Plan slug: `entra-integration-phase-1`
- Created: `2026-02-19`
- Last Updated: `2026-02-20`

## What This Is

Working notes for design and implementation decisions tied to the EE Entra integration plan.

## Decisions

- (2026-02-20) Scope is **Enterprise Edition only**. All user-visible Entra surfaces must be behind feature flags from first release.
- (2026-02-20) Temporal is the execution backbone for discovery/sync runs (initial, single-client, all-tenants).
- (2026-02-20) Phase 1 focuses on feature completeness, not broad operational hardening.
- (2026-02-20) Sync behavior is additive/linking by default; field overwrites occur only for explicitly enabled fields.
- (2026-02-20) Client portal users are excluded from Entra setup/sync functionality.
- (2026-02-20) Use existing RBAC model (`system_settings.read/update`) for Entra setup and sync actions.

## Discoveries / Constraints

- Existing Microsoft OAuth/email/calendar flows already support tenant/env/app credential resolution patterns and `common` authority usage.
- Existing secret system supports env/filesystem/vault read/write provider chains via `getSecretProviderInstance()` and tenant secret APIs.
- Tenant secret metadata/value split is already implemented (`tenant_secrets` DB metadata + secret-provider value storage).
- User model differentiates `internal` vs `client`; middleware and RBAC already branch by `user_type`.
- EE already has platform feature-flag management APIs with tenant-targeting support in PostHog.
- Temporal worker already supports multi-queue registration and has existing integration sync patterns (NinjaOne) to mirror.

## Commands / Runbooks

- Read PRD source: `textutil -convert txt -stdout ~/Downloads/entra-integration-prd.docx`
- Validate plan JSON and references: `python3 ~/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-20-entra-integration-phase-1`

## Links / References

- `~/Downloads/entra-integration-prd.docx`
- `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
- `packages/integrations/src/actions/email-actions/oauthActions.ts`
- `packages/integrations/src/actions/calendarActions.ts`
- `server/src/app/api/auth/microsoft/callback/route.ts`
- `server/src/app/api/auth/microsoft/calendar/callback/route.ts`
- `packages/core/src/lib/secrets/secretProvider.ts`
- `packages/core/src/lib/secrets/VaultSecretProvider.ts`
- `packages/tenancy/src/actions/tenant-secret-actions.ts`
- `shared/workflow/secrets/tenantSecretProvider.ts`
- `server/src/lib/auth/rbac.ts`
- `shared/interfaces/user.interfaces.ts`
- `server/src/middleware/express/authMiddleware.ts`
- `ee/server/src/app/api/v1/platform-feature-flags/route.ts`
- `ee/server/src/lib/platformFeatureFlags/posthogClient.ts`
- `ee/temporal-workflows/src/worker.ts`
- `ee/temporal-workflows/src/workflows/ninjaone-sync-workflow.ts`
- `ee/temporal-workflows/src/activities/ninjaone-sync-activities.ts`
- `ee/server/src/lib/integrations/ninjaone/sync/syncStrategy.ts`

## Open Questions

- Confirm exact delegated scopes needed for direct partner tenant + user enumeration in target MSP environments.
- Confirm CIPP API endpoint/version contract to lock adapter payload parsing.
- Confirm default fuzzy threshold values for mapping suggestions before UI finalization.

## Implementation Log

- (2026-02-20) `F001` completed: added CE Entra route delegator stubs under `server/src/app/api/integrations/entra/*` for root/connect/disconnect/discovery/mappings-preview/mappings-confirm/sync.
- Decision: used the existing EE lazy-import stub pattern with edition checks and a consistent 501 JSON payload (`Microsoft Entra integration is only available in Enterprise Edition.`) for CE/non-EE behavior.
- Added shared CE helper at `server/src/app/api/integrations/entra/_ceStub.ts` to avoid copy/paste drift in runtime/dynamic/exported fallback response behavior.
- Validation command: `cd server && npx vitest run src/test/unit/enterpriseAliasEnvSwitch.unit.test.ts` (pass).
- (2026-02-20) `F002` completed: added EE route handlers for Entra root/connect/disconnect/discovery/mappings-preview/mappings-confirm/sync under `ee/server/src/app/api/integrations/entra/*`.
- Decision: created `ee/server/src/app/api/integrations/entra/_responses.ts` as a shared response/JSON-body parser helper to keep early route contracts stable while deeper business logic lands in later features.
- (2026-02-20) `F003` completed: created `packages/integrations/src/actions/integrations/entraActions.ts` and exported the new action surface from both `packages/integrations/src/actions/integrations/index.ts` and `packages/integrations/src/actions/index.ts`.
- Decision: Entra actions currently call EE route modules through a shared `callEeRoute` helper to keep action and API contracts aligned during phased implementation.
- Validation command: `npx tsc --noEmit -p packages/integrations/tsconfig.json` (pass).
