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
