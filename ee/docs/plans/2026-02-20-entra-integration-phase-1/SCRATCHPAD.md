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
- (2026-02-20) `F004` completed: added an EE Entra entry to Integrations settings in a new `Identity` tab/category and wired it to dynamic-load `@enterprise/components/settings/integrations/EntraIntegrationSettings`.
- Discovery: `@enterprise/*` resolution in shared packages requires matching CE stub files under `packages/ee/src/*`; added Entra stub there to keep CE builds/typecheck valid.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json` and `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F005` completed: implemented EE shell component at `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx` with a 4-step wizard scaffold (Connect, Discover, Map, Initial Sync) and placeholder status/actions.
- (2026-02-20) `F006` completed: gated the Entra `Identity` settings surface with `useFeatureFlag('entra-integration-ui')`; the tab/card renders only when EE mode and flag enabled.
- Decision: kept `useFeatureFlag` hook unchanged; existing default/forced-flag behavior already supports this gate without additional hook work.
- (2026-02-20) `F007` completed: enforced `entra-integration-ui` checks server-side in both EE Entra routes (`ee/server/src/app/api/integrations/entra/*`) and Entra server actions (`packages/integrations/src/actions/integrations/entraActions.ts`).
- Added shared EE guard `requireEntraUiFlagEnabled()` in `ee/server/src/app/api/integrations/entra/_guards.ts` using authenticated user + tenant-aware PostHog evaluation through `featureFlags.isEnabled(...)`.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json` and `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F008` completed: added a client-level `Sync Entra Now` action button in `packages/clients/src/components/clients/ClientDetails.tsx`, wired to `startEntraSync({ scope: 'single-client', clientId })` with success/error toast feedback.
- Validation command: `npx tsc --noEmit -p packages/clients/tsconfig.json` (pass).
- (2026-02-20) `F009` completed: gated the client-level Entra action button with `useFeatureFlag('entra-integration-client-sync-action')`; button now only renders when both EE mode and tenant flag are enabled.
- (2026-02-20) `F010` completed: added canonical Entra Phase 1 flag definitions and an idempotent ensure workflow in `PostHogFeatureFlagService.ensureEntraPhase1Flags()`.
- API workflow update: `POST /api/v1/platform-feature-flags` now supports `{"__action":"ensure_entra_phase1_flags"}` for creating missing Entra flags, and `GET` supports `?includeEntraPhase1Defaults=true` to return definitions alongside current flags.
- Validation commands: `npx tsc --noEmit -p ee/server/tsconfig.json` and `npx tsc --noEmit -p packages/clients/tsconfig.json` (pass).
- (2026-02-20) `F011` completed: added explicit Entra connection option cards in settings and gated CIPP visibility behind `useFeatureFlag('entra-integration-cipp')`.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F012` completed: added field-sync controls and ambiguous queue panels to Entra settings, each gated by their dedicated flags (`entra-integration-field-sync`, `entra-integration-ambiguous-queue`).
- (2026-02-20) `F013` completed via migration `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs`: created `entra_partner_connections` with tenant-scoped connection metadata and lifecycle timestamps.
- Validation command: `node --check ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs` (pass).
- (2026-02-20) `F014` completed: added unique partial index `ux_entra_partner_connections_active_per_tenant` to enforce at most one active partner connection per tenant.
- (2026-02-20) `F015` completed: migration creates `entra_managed_tenants` for persisted discovered tenant records per MSP tenant.
- (2026-02-20) `F016` completed: added managed-tenant lookup indexes for recency and case-insensitive primary-domain matching.
- (2026-02-20) `F017` completed: migration adds `entra_client_tenant_mappings` to persist mapped/skipped/review decisions.
- (2026-02-20) `F018` completed: added unique partial index `ux_entra_client_tenant_mappings_active` to prevent duplicate active mappings per discovered Entra tenant.
- (2026-02-20) `F019` completed: migration creates `entra_sync_settings` for cadence, filters, and field-sync JSON config.
- (2026-02-20) `F020` completed: migration adds parent sync run table `entra_sync_runs` with workflow/status/summary columns.
- (2026-02-20) `F021` completed: migration adds `entra_sync_run_tenants` with FK linkage to parent run rows and per-tenant counters.
- (2026-02-20) `F022` completed: migration adds `entra_contact_links` for Entra identity to contact mapping state.
- (2026-02-20) `F023` completed: unique index `ux_entra_contact_links_entra_identity` enforces (`tenant`,`entra_tenant_id`,`entra_object_id`) uniqueness.
- (2026-02-20) `F024` completed: partial unique index `ux_entra_contact_links_active_contact` enforces one active Entra link per contact.
