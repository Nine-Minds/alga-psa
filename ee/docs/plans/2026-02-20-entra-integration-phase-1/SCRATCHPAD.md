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
- (2026-02-20) `F025` completed: migration creates `entra_contact_reconciliation_queue` plus status/identity indexes for ambiguous match review.
- (2026-02-20) `F026` completed: altered `clients` with `entra_tenant_id` and `entra_primary_domain` columns for mapping write-through.
- (2026-02-20) `F027` completed: added `idx_clients_entra_tenant` for tenant-scoped `clients.entra_tenant_id` lookups.
- (2026-02-20) `F028` completed: altered `contacts` with `entra_object_id`, `entra_sync_source`, and `last_entra_sync_at` metadata fields.
- (2026-02-20) `F029` completed: added contact traceability columns `entra_user_principal_name` and `entra_account_enabled`.
- (2026-02-20) `F030` completed: added `entra_sync_status` and `entra_sync_status_reason` columns to support disabled/deleted-state UX messaging.
- (2026-02-20) `F031` completed: migration seeds one `entra_sync_settings` row per existing tenant with default `sync_interval_minutes=1440` and enabled sync.
- (2026-02-20) `F032` completed: added `ee/server/src/interfaces/entra.interfaces.ts` and typed row mappers in `ee/server/src/lib/integrations/entra/entraRowMappers.ts` for all Entra tables.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F033` completed: added canonical Entra secret key constants in `ee/server/src/lib/integrations/entra/secrets.ts` for shared Microsoft app secrets plus direct/CIPP token keys.
- (2026-02-20) `F034` completed: implemented `resolveMicrosoftCredentialsForTenant()` with explicit tenant-pair -> env-pair -> app-secret-pair precedence in `ee/server/src/lib/integrations/entra/auth/microsoftCredentialResolver.ts`.
- (2026-02-20) `F035` completed: added `initiateEntraDirectOAuth` action with `system_settings.update` permission enforcement and Entra-specific OAuth state payload (tenant/user/nonce/timestamp/redirect).
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json` and `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F036` completed: added `/api/auth/microsoft/entra/callback` server entry with EE branch delegation and EE callback handler that validates state, exchanges code, stores direct tokens in tenant secrets, and marks `entra_partner_connections` active.
- Added matching `packages/ee` route stubs for new Entra/auth callback paths so CE/server alias typechecking resolves cleanly.
- (2026-02-20) `F037` completed: added `refreshEntraDirectToken()` helper to refresh direct OAuth access using stored refresh token and Microsoft credential resolver, then persist rotated token metadata.
- (2026-02-20) `F038` completed: centralized direct OAuth token persistence/rotation in `ee/server/src/lib/integrations/entra/auth/tokenStore.ts` using `getSecretProviderInstance()` tenant secrets.
- Refactor: EE Entra callback and refresh helper now both call `saveEntraDirectTokenSet(...)` / `getEntraDirectRefreshToken(...)` to keep secret writes consistent and vault-compatible.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F039` completed: added `connectEntraCipp` action in `packages/integrations/src/actions/integrations/entraActions.ts` with base URL normalization/validation, required token checks, tenant-secret persistence, and active CIPP connection-row upsert.
- Validation command: `npx tsc --noEmit -p packages/integrations/tsconfig.json` (pass).
- (2026-02-20) `F040` completed: added `ee/server/src/lib/integrations/entra/providers/cipp/cippSecretStore.ts` with save/get/clear helpers using tenant secret provider APIs (vault/filesystem/env chain compatible).
- Refactor: `connectEntraCipp` now uses `saveEntraCippCredentials(...)` instead of writing CIPP secrets inline.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json` and `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F041` completed: added EE `validate-direct` route (`ee/server/src/app/api/integrations/entra/validate-direct/route.ts`) that verifies direct credentials/token and probes Microsoft managed-tenant discovery access, with refresh retry on 401.
- Added server action `validateEntraDirectConnection` and CE/EE route wiring stubs for `/api/integrations/entra/validate-direct`.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json`, `npx tsc --noEmit -p ee/server/tsconfig.json`, `npx tsc --noEmit -p server/tsconfig.json` (pass).
- (2026-02-20) `F042` completed: added EE `validate-cipp` route (`ee/server/src/app/api/integrations/entra/validate-cipp/route.ts`) that loads CIPP credentials from tenant secrets and validates tenant-list access via CIPP API probing.
- Added `validateEntraCippConnection` server action plus CE/EE route wiring stubs for `/api/integrations/entra/validate-cipp`.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json`, `npx tsc --noEmit -p ee/server/tsconfig.json`, `npx tsc --noEmit -p server/tsconfig.json` (pass).
- (2026-02-20) `F043` completed: added `ee/server/src/lib/integrations/entra/connectionRepository.ts` and wired validation routes to persist `status`, `last_validated_at`, and JSON validation snapshots to `entra_partner_connections`.
- Updated `GET /api/integrations/entra` to read active connection state + validation fields from DB, and updated `EntraIntegrationSettings` status panel to render connection status/type, last validation timestamp, and validation error message.
- Validation commands: `npx tsc --noEmit -p ee/server/tsconfig.json`, `npx tsc --noEmit -p packages/integrations/tsconfig.json`, `npx tsc --noEmit -p server/tsconfig.json` (pass).
- (2026-02-20) `F044` completed: disconnect flow now clears direct+CIPP tenant secrets and marks active `entra_partner_connections` rows disconnected via repository update (history rows are retained; no sync-run deletion).
- Updates: `disconnectEntraIntegration` now enforces update permission before route call; `clearEntraDirectTokenSet` now deletes stored token secrets instead of writing empty-string placeholders.
- Validation commands: `npx tsc --noEmit -p ee/server/tsconfig.json`, `npx tsc --noEmit -p packages/integrations/tsconfig.json`, `npx tsc --noEmit -p server/tsconfig.json` (pass).
- (2026-02-20) `F045` completed: enforced connection-type credential cleanup in Entra actions via `clearStaleCredentialsForConnectionType(...)`.
- Behavior: starting direct flow clears CIPP credentials; selecting/connecting CIPP clears direct OAuth token secrets, preventing stale dual-provider secret state.
- Added CE stub for `@enterprise/lib/integrations/entra/auth/tokenStore` to keep non-EE alias builds type-safe.
- Validation commands: `npx tsc --noEmit -p packages/integrations/tsconfig.json`, `npx tsc --noEmit -p ee/server/tsconfig.json`, `npx tsc --noEmit -p server/tsconfig.json` (pass).
- (2026-02-20) `F046` completed: introduced provider abstraction types at `ee/server/src/lib/integrations/entra/providers/types.ts` including `EntraProviderAdapter` contract and normalized managed-tenant/user DTOs shared by direct and CIPP adapters.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F047` completed: added direct provider adapter at `ee/server/src/lib/integrations/entra/providers/direct/directProviderAdapter.ts` with managed-tenant enumeration via Microsoft Graph `tenantRelationships/managedTenants/tenants`.
- Adapter behavior: tenant-scoped access-token resolution, auto-refresh on expiry/401, pagination via `@odata.nextLink`, normalization to canonical tenant DTO (`entraTenantId`, displayName, primaryDomain, sourceUserCount).
- Note: `listUsersForTenant` intentionally left for `F048` and currently throws a clear not-implemented error.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F048` completed: implemented direct adapter per-tenant user enumeration in `listUsersForTenant(...)` using managed-users Graph endpoint with pagination and normalized user DTO mapping.
- Normalized fields include object id, UPN/email, name fields, accountEnabled, job/mobile/business phones, and raw payload passthrough for downstream reconciliation.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
- (2026-02-20) `F049` completed: added CIPP provider adapter at `ee/server/src/lib/integrations/entra/providers/cipp/cippProviderAdapter.ts` with managed-tenant enumeration and normalization.
- Adapter behavior: loads CIPP creds from tenant secret store, probes common tenant-list endpoints, normalizes tenant id/display/domain/user-count, and deduplicates by tenant id.
- Note: `listUsersForTenant` remains a deliberate not-implemented throw until `F050`.
- Validation command: `npx tsc --noEmit -p ee/server/tsconfig.json` (pass).
