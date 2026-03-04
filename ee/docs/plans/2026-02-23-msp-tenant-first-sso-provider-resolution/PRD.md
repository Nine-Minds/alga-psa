# PRD — MSP Tenant-First SSO Provider Resolution

- Slug: `2026-02-23-msp-tenant-first-sso-provider-resolution`
- Date: `2026-02-23`
- Status: Draft

## Summary

Enable MSP login SSO in CE and EE with tenant-first credential resolution for both Microsoft and Google, while preventing user-enumeration leakage.

Behavior target:
- User selects provider on MSP login and enters email.
- System resolves credential source for that specific provider:
  - If internal user exists and their tenant has provider credentials configured in **Settings -> Integrations -> Providers**, use tenant credentials.
  - Otherwise, fall back to app-wide OAuth vars/secrets (`MICROSOFT_OAUTH_*`, `GOOGLE_OAUTH_*`).
- If user does not exist, response behavior must not reveal existence.

This plan also adds Microsoft provider settings to the existing Providers area (Google already exists) and aligns Microsoft integration forms to use provider-setup-first UX.

## Problem

Current gaps:
- Providers setup supports Google only; Microsoft tenant credentials are not managed in the same provider-settings surface.
- CE MSP login SSO is stubbed out.
- Auth provider credential selection is effectively static and app-scoped; it does not select tenant credentials per login attempt.
- Unknown-user handling risks leaking user existence if resolver behavior differs by lookup outcome.

## Goals

1. Add Microsoft provider settings in Providers setup, using tenant secrets.
2. Enable MSP login SSO in CE for Google and Microsoft.
3. Resolve SSO credential source per provider, per login attempt (tenant first, app fallback).
4. Keep client portal out of scope for this phase.
5. Enforce no user-enumeration leak in resolver/start behavior.

## Non-goals

- Client portal SSO enablement.
- Full EE account-linking parity work in CE (`user_auth_accounts` migration parity, bulk SSO assignment, advanced linking UX).
- New observability platforms, dashboards, or broad rollout framework changes.
- Reworking non-MSP login surfaces.

## Users and Primary Flows

### Personas
- MSP internal user: signs in via Microsoft/Google SSO.
- Tenant admin: configures provider credentials under Providers settings.

### Primary Flow A — Tenant-configured SSO
1. MSP user enters email and clicks `Sign in with Microsoft` (or Google).
2. Resolver finds internal user and tenant provider config.
3. Resolver sets signed short-lived context cookie (no secrets inside) and returns success.
4. UI calls NextAuth `signIn(provider)`.
5. NextAuth loads provider credentials from tenant secrets using resolver context.
6. OAuth completes and user lands authenticated.

### Primary Flow B — Fallback SSO
1. MSP user enters email and clicks provider button.
2. Resolver does not find tenant config (or user is missing).
3. Resolver uses app fallback config when available.
4. OAuth continues with app credentials.

### Primary Flow C — No credentials available
1. Resolver determines neither tenant nor app credentials are available.
2. UI shows generic failure message (same language regardless of lookup result).

## UX / UI Notes

- MSP login SSO buttons are enabled only after email entry.
- Same button labels/icons for Microsoft and Google.
- Generic error text only for resolver/start failures.
- Client portal SSO remains unchanged/disabled.
- Providers tab now shows:
  - Google settings card (existing)
  - Microsoft settings card (new)
- Microsoft integration forms (email/calendar) should guide users to Providers settings when provider config is missing, instead of requiring per-provider client ID/secret entry.

## Requirements

### Functional Requirements

1. Add Microsoft provider settings component to Providers tab.
2. Add Microsoft provider settings actions:
   - `getMicrosoftIntegrationStatus`
   - `saveMicrosoftIntegrationSettings`
   - `resetMicrosoftProvidersToDisconnected`
3. Store Microsoft provider settings in tenant secrets:
   - `microsoft_client_id`
   - `microsoft_client_secret`
   - `microsoft_tenant_id` (default `common`)
4. Implement MSP SSO resolver endpoint that accepts provider + email and returns generic outcome.
5. Resolver selection logic per provider:
   - Tenant provider ready -> tenant source.
   - Else app fallback ready -> app source.
   - Else generic failure.
6. Unknown-user resolver behavior must match known-user-missing behavior externally.
7. Resolver writes signed short-lived context cookie with source metadata only (no raw secrets).
8. NextAuth Google/Microsoft provider configuration must read resolver context per request and load correct secrets.
9. CE must support MSP OAuth providers (remove current effective EE-only gating for MSP SSO usage).
10. CE OAuth profile mapping for MSP SSO must resolve internal users safely without EE-only registry dependencies.
11. Remove/adjust auth options cache so per-request resolver context can affect provider credential selection.
12. Microsoft email/calendar forms in CE should no longer require direct credential entry and should use provider-settings-first UX.
13. Keep existing behavior when resolver context is absent: app fallback only.

### Non-functional Requirements

1. Resolver endpoint uses short-lived signed context (tamper-resistant).
2. Resolver applies basic rate limiting to reduce abuse.
3. No sensitive secret values in logs, responses, or cookies.
4. Security behavior consistent across CE and EE builds.

## Data / API / Integrations

### Secret keys

Tenant-level:
- `google_client_id`
- `google_client_secret`
- `microsoft_client_id`
- `microsoft_client_secret`
- `microsoft_tenant_id`

App fallback:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`
- `MICROSOFT_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_TENANT_ID` (optional)

### New endpoint

`POST /api/auth/msp/sso/resolve`

Request:
```json
{
  "provider": "google | azure-ad",
  "email": "user@example.com",
  "callbackUrl": "/..."
}
```

Response (success):
```json
{ "ok": true }
```

Response (generic failure):
```json
{ "ok": false, "message": "We couldn\'t start SSO sign-in. Please verify provider setup and try again." }
```

### Resolver context cookie

`msp_sso_resolution` (httpOnly, secure in prod, sameSite=lax, short TTL)

Payload (signed):
- provider
- source (`tenant` | `app`)
- tenantId (optional)
- userId (optional)
- issuedAt
- expiresAt
- nonce

No raw client IDs/secrets in cookie.

## Security / Permissions

- Microsoft provider settings save/reset actions require `system_settings:update`.
- Client portal users cannot access provider settings actions.
- Resolver does not expose whether user lookup succeeded.
- Unknown-user and known-user-missing-provider outcomes must have same external shape/status/message.
- Basic rate limiting for resolver endpoint.
- Signed short-lived resolver cookie to prevent tampering.

## Observability

Out of scope for dedicated dashboards/metrics. In scope:
- Structured server logs for resolver source selection and failures (no secrets, no explicit user-existence signals).

## Rollout / Migration

- No database schema migration required for this scope.
- No migration of existing integration provider rows.
- CE enablement is code-path/config based.
- `.env.example` should clarify OAuth fallback variables are used for MSP SSO fallback.

## Open Questions

None blocking for initial implementation.

## Acceptance Criteria (Definition of Done)

1. Providers tab includes Microsoft settings alongside Google.
2. Tenant admin can save Microsoft provider secrets; status view masks sensitive values.
3. MSP login in CE shows Google/Microsoft SSO buttons and requires email before SSO attempt.
4. Resolver applies tenant-first then app-fallback selection for both providers.
5. Unknown-user SSO attempts do not produce distinguishable user-existence responses.
6. NextAuth uses resolver-selected source per request; static cache no longer blocks per-request selection.
7. CE OAuth profile mapping works for MSP internal users without EE registry runtime errors.
8. Client portal SSO behavior remains unchanged.
9. Microsoft email/calendar provider forms use provider-settings-first UX and no longer require per-provider credential entry in CE.
