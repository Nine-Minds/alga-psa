# PRD — MSP Domain-Scoped SSO Discovery

- Slug: `2026-02-24-msp-domain-scoped-sso-discovery`
- Date: `2026-02-24`
- Status: Draft

## Summary

Add domain-based tenant discovery to MSP login so SSO provider options are filtered by tenant configuration without pre-auth user lookup.

Behavior target:
- User types email on MSP login.
- System derives email domain and resolves tenant context by domain mapping (not by user existence).
- UI enables only providers configured for that tenant domain.
- If no tenant domain mapping is found, UI falls back to environment-wide provider availability.
- Existing `/auth/msp/signin` URLs and existing email links remain valid; no hostname migration is required.

## Problem

Current MSP SSO behavior has two issues:
1. Public login cannot safely use per-user provider eligibility because that creates user-enumeration risk.
2. UI currently enables both Google and Microsoft once email is non-empty, even when a tenant only supports one provider.

We need provider filtering that is tenant-aware, but still safe for a public unauthenticated surface.

## Goals

1. Filter MSP SSO options by tenant/provider configuration using domain-level discovery, not user-level discovery.
2. Preserve anti-enumeration posture for user existence.
3. Keep current hosted login paths working (no breaking link migration).
4. Keep CE and EE behavior aligned for MSP login.

## Non-goals

1. Introducing required custom hosted login domains (`<tenant>.algapsa.com`) in this phase.
2. Changing client portal login behavior.
3. Reworking OAuth account-linking model or bulk SSO assignment flows.
4. Building new analytics/monitoring systems beyond existing logs.

## Users and Primary Flows

### Personas
- MSP internal user signing into `/auth/msp/signin`.
- Tenant admin configuring provider settings and tenant login domains.

### Primary Flow A — Known Domain, Tenant-Scoped Provider
1. User enters `user@acme.com`.
2. Discovery resolves `acme.com` -> tenant.
3. Tenant provider readiness indicates Microsoft only.
4. UI enables `Sign in with Microsoft` and keeps Google disabled.
5. Resolver/start continues OAuth using tenant credentials.

### Primary Flow B — Known Domain, Multiple Tenant Providers
1. User enters `user@example.com`.
2. Discovery resolves domain to tenant.
3. Tenant has both Google and Microsoft configured.
4. UI enables both providers.

### Primary Flow C — Unknown Domain (or unresolved mapping)
1. User enters email with unmapped domain.
2. Discovery returns app-fallback provider availability only.
3. UI reflects app-level providers (if configured) with no user lookup.

### Primary Flow D — Credentials Login
1. User signs in with email/password.
2. Existing credentials path remains unchanged.

## UX / UI Notes

1. MSP login keeps existing layout and credential form.
2. SSO buttons remain disabled until a syntactically valid email is present.
3. After discovery, only allowed providers are enabled.
4. Unknown/unmapped domain and known domain with no provider should remain neutral in messaging.
5. Optionally remember last chosen SSO provider locally for convenience; this must not bypass server eligibility checks.

## Requirements

### Functional Requirements

1. Add tenant login-domain mapping storage that supports many domains per tenant and domain normalization.
2. Add provider settings UI/actions to manage tenant login domains.
3. Add MSP SSO discovery endpoint that accepts email, derives domain, and returns allowed provider IDs.
4. Discovery must use domain->tenant mapping only and must not query by full email for user existence decisions.
5. Discovery provider resolution rules:
   - If tenant resolved: allowed providers = tenant providers that are configured.
   - If tenant unresolved: allowed providers = app-fallback providers configured via `*_OAUTH_*` secrets/env.
6. Add signed, short-lived discovery context cookie for resolver use (tenant/source/provider set metadata only; no raw secrets).
7. Update MSP SSO button component to call discovery and enable provider buttons from discovery response.
8. Update resolver/start endpoint to honor discovery context and reject provider attempts not in resolved allowed set.
9. Keep resolver/start external failure behavior generic and non-enumerating for user existence.
10. Keep OAuth callback/user mapping behavior unchanged: unknown users still fail at auth mapping stage without exposing explicit existence details.
11. Keep current `/auth/msp/signin` route and existing deep links/email links unchanged.
12. Ensure CE and EE share the same domain discovery and provider gating behavior for MSP login.

### Non-functional Requirements

1. Anti-enumeration: no pre-auth UI or API behavior may vary based on whether a specific user exists.
2. Discovery endpoint must be rate-limited.
3. Logs must avoid raw email; use domain or hashed identifiers where needed.
4. Discovery and resolver cookies must be signed, short-lived, httpOnly, and sameSite-lax.

## Data / API / Integrations

### Data model

Add a tenant-scoped domain mapping model (table or equivalent persistent store) with:
- `tenant`
- `domain` (normalized lowercase)
- `is_active`
- audit timestamps/actor metadata

Required query behavior:
- Resolve tenant by domain quickly.
- Detect ambiguous mappings; ambiguous mappings must be treated as unresolved for discovery.

### Endpoint

`POST /api/auth/msp/sso/discover`

Request:
```json
{
  "email": "user@example.com"
}
```

Response:
```json
{
  "ok": true,
  "providers": ["google", "azure-ad"]
}
```

Notes:
- Response shape remains invariant.
- `providers` may be empty.
- No user-existence information is returned.

### Existing endpoint updates

`POST /api/auth/msp/sso/resolve`
- Consume discovery context cookie.
- Enforce requested provider is currently eligible for resolved source.
- Keep generic failure schema and anti-enumeration behavior.

## Security / Permissions

1. Only authorized internal admins can edit tenant login-domain mappings in settings.
2. Discovery endpoint is public but rate-limited.
3. Domain mapping conflicts/ambiguity must fail closed (no tenant context returned).
4. No cookie or response may contain client secrets.
5. Unknown-user handling remains non-reactive to avoid user enumeration leaks.

## Observability

In-scope:
- Structured logs for discovery source (`tenant` vs `app`) and provider set size.

Out-of-scope:
- New dashboards/metrics infrastructure.

## Rollout / Migration

1. Add data migration for tenant login-domain mapping storage.
2. Backfill optional starter domain from tenant primary email domain only when unambiguous.
3. Keep legacy login URLs and existing email links unchanged.
4. Roll out discovery gating without requiring hostname/custom-domain cutover.

## Open Questions

1. Should duplicate domain claims across tenants be blocked at write-time or allowed and treated as unresolved at read-time?
2. Should fallback to app-level providers be enabled for unresolved domains in production by default, or behind a config switch?
3. Should “remember provider” be local-storage only or signed cookie-based?

## Acceptance Criteria (Definition of Done)

1. Tenant admins can manage tenant login domains in Providers settings.
2. MSP login enables only tenant-configured providers for known tenant domains.
3. MSP login falls back to app-level providers for unresolved domains.
4. No pre-auth user existence signal is exposed via UI/API behavior.
5. Resolver enforces discovered provider eligibility and preserves generic failures.
6. Existing login/deep links continue to work without hostname migration.
7. CE and EE MSP login SSO behavior is consistent for domain discovery and provider gating.
