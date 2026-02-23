# Scratchpad — MSP Tenant-First SSO Provider Resolution

- Plan slug: `2026-02-23-msp-tenant-first-sso-provider-resolution`
- Created: `2026-02-23`

## What This Is

Working notes for MSP SSO tenant-first resolver and provider-settings changes (Microsoft + Google), with CE enablement and no user-enumeration leakage.

## Decisions

- (2026-02-23) Scope includes both Microsoft and Google for MSP SSO tenant-first resolution; client portal remains out of scope.
- (2026-02-23) Resolver behavior: tenant config first, app fallback second, generic failure when no source exists.
- (2026-02-23) Unknown-user attempts must not produce externally distinguishable behavior from known-user-missing-provider cases.
- (2026-02-23) Microsoft provider credentials will be managed in Providers settings, not per-provider email/calendar forms.
- (2026-02-23) CE MSP SSO will be enabled through shared auth codepath changes instead of EE-only UI gating.
- (2026-02-23) Resolver context will use short-lived signed cookie metadata (no raw secrets) to drive per-request secret selection.
- (2026-02-23) Keep implementation core-focused: no dedicated metrics/dashboard/rollout framework changes in this phase.
- (2026-02-23) Added a dedicated `MicrosoftIntegrationSettings` Providers card now, with action wiring deferred to F002-F011 to keep each checklist item atomic.

## Discoveries / Constraints

- (2026-02-23) Providers setup currently shows only Google (`packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`).
- (2026-02-23) CE MSP SSO entry is a null stub (`packages/auth/src/components/SsoProviderButtons.tsx`), while EE maps to `ee/server/src/components/auth/SsoProviderButtons.tsx` via `server/next.config.mjs`.
- (2026-02-23) NextAuth provider registration in shared auth options is currently EE-gated (`packages/auth/src/lib/nextAuthOptions.ts`) and uses app OAuth keys.
- (2026-02-23) NextAuth options are cached (`cachedOptions`), which conflicts with per-request credential-source selection.
- (2026-02-23) Secret provider interface supports tenant writes but not app writes (`packages/core/src/lib/secrets/ISecretProvider.ts`), so Providers UI cannot write app-wide OAuth keys.
- (2026-02-23) Microsoft integration flows already use tenant secret keys (`microsoft_client_id`, `microsoft_client_secret`, `microsoft_tenant_id`) in several existing routes/actions.
- (2026-02-23) Google provider settings already persist tenant `google_client_id`/`google_client_secret` and can be reused as tenant SSO source for Google.
- (2026-02-23) Existing calendar OAuth state store (`packages/integrations/src/utils/calendar/oauthStateStore.ts`) demonstrates Redis + memory fallback pattern for short-lived one-time state.
- (2026-02-23) Providers tab currently renders one "Google" integration entry that can host both provider cards in a single container (`IntegrationsSettingsPage.tsx`).

## Progress Log

- (2026-02-23) `F001` complete: added Microsoft provider card component at `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` and rendered it in Providers tab beneath Google settings.
- (2026-02-23) `T001` complete: added `IntegrationsSettingsPage.providers.test.ts` to assert Providers composition includes both `GoogleIntegrationSettings` and `MicrosoftIntegrationSettings`.
- (2026-02-23) `F002` complete: added `getMicrosoftIntegrationStatus` action in `packages/integrations/src/actions/integrations/microsoftActions.ts` with masked secret output, derived Microsoft redirect URIs (`email`, `calendar`, `sso`), and scope metadata.
- (2026-02-23) `F003` complete: added `saveMicrosoftIntegrationSettings` action with validation for required client ID/client secret and optional tenant ID normalization (`common` default).
- (2026-02-23) `F004` complete: added `resetMicrosoftProvidersToDisconnected` action that disconnects Microsoft email/calendar providers and clears Microsoft token + webhook state across `microsoft_email_provider_config` and `microsoft_calendar_provider_config`.
- (2026-02-23) `F005` complete: exported Microsoft integrations actions from both `packages/integrations/src/actions/integrations/index.ts` and `packages/integrations/src/actions/index.ts`.
- (2026-02-23) `F006` complete: `saveMicrosoftIntegrationSettings` persists `microsoft_client_id` using `secretProvider.setTenantSecret(tenant, 'microsoft_client_id', clientId)`.
- (2026-02-23) `F007` complete: `saveMicrosoftIntegrationSettings` persists `microsoft_client_secret` as tenant secret.
- (2026-02-23) `F008` complete: `saveMicrosoftIntegrationSettings` persists `microsoft_tenant_id` with default `common` when input is blank.
- (2026-02-23) `F009` complete: Microsoft provider settings UI now loads status and displays masked secret indicator (`Stored secret: ••••`) via `status.config.clientSecretMasked`.
- (2026-02-23) `F010` complete: `saveMicrosoftIntegrationSettings` and `resetMicrosoftProvidersToDisconnected` now enforce RBAC via `hasPermission(user, 'system_settings', 'update')`.
- (2026-02-23) `F011` complete: status/save/reset Microsoft actions consistently reject client-portal user context with `Forbidden`.
- (2026-02-23) `F012` complete: added `getMicrosoftProviderReadiness(tenant)` helper in `packages/integrations/src/actions/integrations/providerReadiness.ts` requiring both `microsoft_client_id` and `microsoft_client_secret`.
- (2026-02-23) `F013` complete: added `getGoogleProviderReadiness(tenant)` helper that checks only `google_client_id` + `google_client_secret` (no Gmail Pub/Sub dependency).
- (2026-02-23) `F014` complete: removed manual `clientId`/`clientSecret` requirements and fields from `MicrosoftProviderForm` schema/UI; OAuth configuration now relies on Providers-managed credentials.
- (2026-02-23) `F015` complete: Microsoft email form now shows a "Configure Providers first" CTA (`configure-microsoft-providers-link`) when Microsoft provider readiness is false.
- (2026-02-23) `F016` complete: Microsoft calendar form now checks provider readiness, shows a Providers-first CTA when missing, and disables OAuth connect until provider settings are ready.
- (2026-02-23) `F017` complete: `persistMicrosoftConfig` now resolves Microsoft credentials from tenant provider secrets before per-provider payload values, so CE email provider persistence does not require form-entered client credentials.
- (2026-02-23) `F018` complete: Microsoft calendar form persists provider metadata without client credential inputs by creating/updating providers with provider-settings-first OAuth flow.
- (2026-02-23) `F019` complete: replaced CE `SsoProviderButtons` null stub with a real Google/Microsoft MSP SSO button component in `packages/auth/src/components/SsoProviderButtons.tsx`.
- (2026-02-23) `F020` complete: MSP SSO buttons are disabled until a non-empty email is entered (`hasEmail` gate in `SsoProviderButtons`).
- (2026-02-23) `F021` complete: Microsoft SSO button now calls `POST /api/auth/msp/sso/resolve` with `{ provider: 'azure-ad', email, callbackUrl }` before invoking `signIn('azure-ad')`.
- (2026-02-23) `F022` complete: Google SSO button now follows the same resolver-first flow (`provider: 'google'`) before `signIn('google')`.
- (2026-02-23) `F023` complete: MSP login SSO UI now always shows the same generic start-failure message and does not surface resolver-specific error text.
- (2026-02-23) `F024` complete: client portal login remains unchanged; `ClientLoginForm` still keeps SSO section commented out.
- (2026-02-23) `F025` complete: added unauthenticated resolver route `server/src/app/api/auth/msp/sso/resolve/route.ts` and shared resolver utilities in `packages/auth/src/lib/sso/mspSsoResolution.ts`.
- (2026-02-23) `F026` complete: resolver validates provider/email/callbackUrl, normalizes email casing/whitespace, and returns only generic failure responses for malformed input.
- (2026-02-23) `F027` complete: resolver performs internal-user lookup on normalized email (`LOWER(email)`) strictly for source-selection decisions.
- (2026-02-23) `F028` complete: resolver selects tenant source when an internal user exists and tenant credentials for the chosen provider are ready.
- (2026-02-23) `F029` complete: resolver falls back to app OAuth credentials when tenant source is unavailable and provider fallback keys are configured.
- (2026-02-23) `F030` complete: unknown-user attempts follow the same external success/failure behavior as known-user-without-tenant-config paths.
- (2026-02-23) `F031` complete: resolver returns stable `200` + `{ ok: true|false }` schema regardless of lookup outcome, with generic failure payload shape.
- (2026-02-23) `F032` complete: resolver issues signed, short-lived, httpOnly `msp_sso_resolution` cookie containing only source metadata.
- (2026-02-23) `F033` complete: resolver cookie payload intentionally omits raw OAuth client IDs and client secrets.
- (2026-02-23) `F034` complete: Microsoft fallback readiness in resolver uses `MICROSOFT_OAUTH_CLIENT_ID` + `MICROSOFT_OAUTH_CLIENT_SECRET` (env/app secrets).
- (2026-02-23) `F035` complete: Google fallback readiness in resolver uses `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (env/app secrets).
- (2026-02-23) `F036` complete: resolver returns the generic `ok:false` failure payload when no tenant or app credential source is available.
- (2026-02-23) `F037` complete: resolver now applies in-memory rate limiting keyed by request IP + hashed normalized email bucket.
- (2026-02-23) `F038` complete: resolver logs now include only provider/source classification and generic failure context without raw email, secrets, or explicit existence flags.
- (2026-02-23) `F039` complete: removed EE-only gating around Google/Microsoft provider registration in NextAuth options so CE can register MSP OAuth providers when credentials exist.
- (2026-02-23) `F040` complete: removed static `cachedOptions`; `getAuthOptions()` now rebuilds per request so resolver cookie context can affect provider credentials.
- (2026-02-23) `F041` complete: OAuth secret resolution now reads `msp_sso_resolution` cookie context and applies tenant-scoped Google/Microsoft credentials when valid tenant source is requested.
- (2026-02-23) `F042` complete: when resolver cookie context is missing/invalid/expired, OAuth secret resolution keeps using app-level fallback credentials only.
- (2026-02-23) `F043` complete: tenant-source cookie context is accepted only after HMAC signature and expiry checks in `parseAndVerifyMspSsoResolutionCookie`.
- (2026-02-23) `F044` complete: resolver writes a freshly signed cookie (new nonce + expiry) on each successful start attempt, replacing stale context.
- (2026-02-23) `F045` complete: added CE-safe OAuth mapper `mapCeOAuthProfileToExtendedUser` for Google/Microsoft MSP sign-in lookups by normalized internal email.
- (2026-02-23) `F046` complete: Google/Microsoft profile callbacks now route through `mapOAuthProfileToExtendedUser`, which selects CE mapper in community edition.
- (2026-02-23) `F047` complete: enterprise builds still follow the existing SSO registry mapper path (`isEnterprise` branch) unchanged.
- (2026-02-23) `F048` complete: CE now bypasses EE account-link persistence by short-circuiting `ensureOAuthAccountLink` when `isEnterprise` is false.
- (2026-02-23) `F049` complete: Microsoft provider issuer now uses `${tenantId || 'common'}` to ensure empty tenant IDs default to `common`.
- (2026-02-23) `F050` complete: added explicit anti-enumeration comments in resolver route to prevent exposing lookup outcomes in client-visible responses.
- (2026-02-23) `F051` complete: `.env.example` now documents `GOOGLE_OAUTH_*`/`MICROSOFT_OAUTH_*` as CE MSP SSO fallback keys (not EE-only).
- (2026-02-23) `F052` complete: added `docs/integrations/provider-setup-order.md` documenting Providers-first setup, then integration-level OAuth connection for Google/Microsoft.

## Commands / Runbooks

- (2026-02-23) List existing plans and artifacts:
  - `find ee/docs/plans -maxdepth 2 -type f \( -name PRD.md -o -name features.json -o -name tests.json -o -name SCRATCHPAD.md \) | head -n 40`
- (2026-02-23) Scaffold this plan folder from ALGA templates:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "MSP Tenant-First SSO Provider Resolution" --slug 2026-02-23-msp-tenant-first-sso-provider-resolution --no-date-prefix`
- (2026-02-23) Validate plan artifact structure:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py --plan-dir ee/docs/plans/2026-02-23-msp-tenant-first-sso-provider-resolution`

## Links / References

- Existing Google provider settings PRD template pattern:
  - `ee/docs/plans/2026-01-04-tenant-owned-google-oauth/PRD.md`
- Shared auth options and provider gating:
  - `packages/auth/src/lib/nextAuthOptions.ts`
- CE/EE SSO button entry aliasing:
  - `server/next.config.mjs`
  - `packages/auth/src/components/SsoProviderButtons.tsx`
  - `ee/server/src/components/auth/SsoProviderButtons.tsx`
- Providers settings page:
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- Microsoft email/calendar forms (CE):
  - `packages/integrations/src/components/email/MicrosoftProviderForm.tsx`
  - `packages/integrations/src/components/calendar/MicrosoftCalendarProviderForm.tsx`
- Secret provider interface:
  - `packages/core/src/lib/secrets/ISecretProvider.ts`

## Open Questions

- None blocking for initial implementation phase.
- (2026-02-23) `T002` complete: added unit coverage in `microsoftActions.test.ts` proving `getMicrosoftIntegrationStatus` returns `success:true` for authorized internal admin context.
- (2026-02-23) `T003` complete: `microsoftActions.test.ts` asserts Microsoft status returns masked secret indicators and never returns raw client secret text.
- (2026-02-23) `T004` complete: unit coverage verifies `saveMicrosoftIntegrationSettings` rejects blank `clientId`.
- (2026-02-23) `T005` complete: unit coverage verifies `saveMicrosoftIntegrationSettings` rejects blank `clientSecret`.
- (2026-02-23) `T006` complete: save action test verifies default `microsoft_tenant_id` of `common` when tenant ID input is omitted.
- (2026-02-23) `T007` complete: save action test verifies persistence of tenant secret key `microsoft_client_id`.
- (2026-02-23) `T008` complete: save action test verifies persistence of tenant secret key `microsoft_client_secret`.
- (2026-02-23) `T009` complete: save action test verifies persistence of tenant secret key `microsoft_tenant_id`.
- (2026-02-23) `T010` complete: status action test validates derived redirect URIs and scope metadata for Microsoft email/calendar/SSO.
- (2026-02-23) `T011` complete: reset action test verifies Microsoft email provider rows are set disconnected and token/webhook fields are cleared.
- (2026-02-23) `T012` complete: reset action test verifies Microsoft calendar provider rows are set disconnected and token/subscription fields are cleared.
- (2026-02-23) `T013` complete: export coverage verifies Microsoft integration actions are present in integrations index entrypoints.
- (2026-02-23) `T014` complete: save action test verifies non-admin users without `system_settings:update` receive `Forbidden`.
- (2026-02-23) `T015` complete: status/save/reset action tests verify client-portal user context is denied with `Forbidden`.
- (2026-02-23) `T016`/`T017`/`T023` implemented in `providerReadiness.test.ts`; readiness now validated as secret-pair checks (`microsoft_client_*`, `google_client_*`) with explicit assertion that Google readiness does not depend on Gmail Pub/Sub keys.
- (2026-02-23) Command run: `cd server && npx vitest run ../packages/integrations/src/actions/integrations/microsoftActions.test.ts ../packages/integrations/src/actions/integrations/providerReadiness.test.ts`.
- (2026-02-23) `T017` complete: `providerReadiness.test.ts` verifies Google readiness is true only when both `google_client_id` and `google_client_secret` are configured.
- (2026-02-23) `T023` complete: Google readiness coverage explicitly asserts Pub/Sub keys are not required for MSP SSO readiness decisions.
- (2026-02-23) `T018` complete: `microsoftProviders.providersFirst.test.ts` verifies CE Microsoft email form no longer requires manual `clientId`/`clientSecret` fields and uses providers-managed credentials.
- (2026-02-23) `T019` complete: providers-first contract test verifies Microsoft email form renders CTA (`configure-microsoft-providers-link`) to Providers settings when readiness is false.
- (2026-02-23) `T020` complete: providers-first contract test verifies Microsoft calendar form renders CTA (`configure-microsoft-calendar-providers-link`) when provider readiness is missing.
- (2026-02-23) `T021` complete: calendar providers-first contract test verifies create flow submits metadata and uses empty vendor credential fields (no manual OAuth credential entry requirement).
- (2026-02-23) `T022` complete: persistence contract test verifies Microsoft email provider action derives effective credentials from hosted/tenant secrets and does not rely on form-entered secrets.
- (2026-02-23) `T024` complete: added `SsoProviderButtons.msp.test.tsx` to validate CE MSP login renders both Google and Microsoft SSO buttons.
- (2026-02-23) Command run: `cd server && npx vitest run --coverage.enabled=false ../packages/auth/src/components/SsoProviderButtons.msp.test.tsx ../packages/auth/src/components/ClientLoginForm.ssoGuard.test.ts`.
- (2026-02-23) `T025` complete: SSO button interaction tests verify both providers stay disabled until a non-empty email is supplied.
- (2026-02-23) `T026` complete: component test verifies Microsoft button performs resolver POST first and only then invokes `signIn('azure-ad')`.
- (2026-02-23) `T027` complete: component test verifies Google button performs resolver POST first and then calls `signIn('google')`.
- (2026-02-23) `T028` complete: failure-path component test verifies resolver/network failures always emit one generic MSP SSO start error message.
- (2026-02-23) `T029` complete: client portal login contract test verifies `ClientLoginForm` keeps SSO section commented/disabled with no new client portal SSO affordance.
- (2026-02-23) `T030` complete: added resolver route unit coverage validating valid payload -> `{ ok: true }` and signed `msp_sso_resolution` cookie set on success.
- (2026-02-23) Added auth/server test suites: `packages/auth/src/lib/sso/mspSsoResolution.test.ts` and `server/src/app/api/auth/msp/sso/resolve/route.test.ts`.
- (2026-02-23) Added Vitest alias for `@alga-psa/auth/lib/sso/mspSsoResolution` in `server/vitest.config.ts` to enable route test resolution.
- (2026-02-23) Command run: `cd server && npx vitest run --coverage.enabled=false ../packages/auth/src/lib/sso/mspSsoResolution.test.ts src/app/api/auth/msp/sso/resolve/route.test.ts`.
- (2026-02-23) `T031` complete: resolver route test verifies invalid provider input returns the generic `{ ok:false, message }` response contract.
- (2026-02-23) `T032` complete: `mspSsoResolution.test.ts` verifies resolver lowercases/trims email before DB lookup binding.
- (2026-02-23) `T033` complete: helper test verifies Microsoft tenant source selection when user exists and tenant Microsoft secrets are ready.
- (2026-02-23) `T034` complete: helper test verifies Google tenant source selection when user exists and tenant Google secrets are ready.
- (2026-02-23) `T035` complete: helper test verifies Microsoft app fallback source when tenant Microsoft secrets are unavailable.
- (2026-02-23) `T036` complete: helper test verifies Google app fallback source when tenant Google secrets are unavailable.
- (2026-02-23) `T037` complete: route test verifies unknown-user and known-user-missing-tenant both produce identical success schema with app fallback.
- (2026-02-23) `T038` complete: route test verifies unknown-user and known-user-no-source both return identical generic failure payload.
- (2026-02-23) `T039` complete: signed-cookie helper test verifies payload/value exclude raw OAuth client IDs and secrets.
- (2026-02-23) `T040` complete: signed-cookie helper test validates provider/source/issuedAt/expiresAt/nonce fields plus parseable signature.
- (2026-02-23) `T041` complete: helper test asserts Microsoft app fallback checks use `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`.
- (2026-02-23) `T042` complete: helper test asserts Google app fallback checks use `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
- (2026-02-23) `T043` complete: helper test verifies invalid signature and expired cookie contexts are rejected by resolver-cookie parser.
- (2026-02-23) `T044` complete: route test verifies rate-limited requests still return the same generic failure response.
- (2026-02-23) `T045` complete: route test verifies logs include provider/source classification without raw email, secret material, or user-existence fields.
- (2026-02-23) `T046` complete: added `nextAuthOptions.mspContract.test.ts` asserting CE path registers Google/Microsoft providers when credential inputs are available.
- (2026-02-23) Added auth/doc test suites: `ceOAuthProfileMapper.test.ts`, `nextAuthOptions.mspContract.test.ts`, and `mspSsoDocsContract.test.ts`.
- (2026-02-23) Command run: `cd server && npx vitest run --coverage.enabled=false ../packages/auth/src/lib/sso/ceOAuthProfileMapper.test.ts ../packages/auth/src/lib/nextAuthOptions.mspContract.test.ts ../packages/auth/src/lib/sso/mspSsoDocsContract.test.ts`.
- (2026-02-23) `T047` complete: NextAuth contract test verifies `getAuthOptions` returns `buildAuthOptions()` directly and no static `cachedOptions` cache remains.
- (2026-02-23) `T048` complete: NextAuth contract test verifies tenant-scoped Microsoft credentials are read when resolver cookie selects tenant source.
- (2026-02-23) `T049` complete: NextAuth contract test verifies tenant-scoped Google credentials are read when resolver cookie selects tenant source.
- (2026-02-23) `T050` complete: NextAuth contract test verifies invalid/absent resolver context returns early to app-level fallback credential set.
- (2026-02-23) `T051` complete: NextAuth contract test verifies expired resolver context is ignored through the same early-return fallback path.
- (2026-02-23) `T052` complete: resolver route test verifies consecutive successful starts set different cookie values (overwrite behavior).
- (2026-02-23) `T053` complete: CE mapper unit test verifies normalized-email resolution for Microsoft profile and expected extended user shape.
