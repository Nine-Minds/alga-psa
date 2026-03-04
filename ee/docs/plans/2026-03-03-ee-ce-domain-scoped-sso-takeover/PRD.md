# PRD — EE+CE Domain-Scoped SSO Takeover and Domain Approval

- Slug: `ee-ce-domain-scoped-sso-takeover`
- Date: `2026-03-03`
- Status: Draft

## Summary

Extend MSP domain-scoped SSO discovery so it works cleanly across both Enterprise Edition (EE, multi-tenant) and Community Edition (CE, on-prem), while enabling customer-owned Google/Microsoft providers for claimed domains.

Key behavior target:
- MSP login in both EE and CE uses email-domain discovery to decide which SSO providers are eligible.
- In EE, tenant takeover of a domain requires domain ownership verification before tenant providers are used.
- In CE, domain registration is advisory (no mandatory ownership verification gate).
- For domains not covered by an approved/eligible tenant registration, discovery falls back to Nine Minds standard app-level SSO provider configuration.

## Problem

Domain-scoped SSO discovery exists, but we need a complete product model for customer-owned provider takeover that is safe and operationally clear:

1. EE needs a domain ownership approval process so tenants cannot claim domains they do not control.
2. CE needs login-screen parity using the same discovery mechanism, but with simpler (advisory) domain registration.
3. Unmanaged or not-yet-approved domains must reliably route to Nine Minds default SSO providers.
4. This must preserve anti-enumeration behavior and avoid regressions to existing `/auth/msp/signin` flows.

## Goals

1. Support domain-scoped SSO routing in both EE and CE on `/auth/msp/signin`.
2. Add EE-only domain ownership verification before tenant domain takeover is active.
3. Keep CE domain registration advisory, per product decision, while still supporting discovery-driven login UX.
4. Route unmanaged/unapproved domains to Nine Minds default SSO providers.
5. Preserve anti-enumeration posture and existing credentials login behavior.

## Non-goals

1. Changing client portal sign-in behavior.
2. Introducing new IdPs beyond Google and Microsoft in this phase.
3. Redesigning OAuth account linking or bulk SSO assignment semantics.
4. Introducing mandatory custom hosted login domains.

## Users and Primary Flows

### Personas
- MSP internal user signing into `/auth/msp/signin`.
- EE tenant admin managing SSO domains and provider credentials.
- CE admin managing advisory domain registrations.

### Primary Flow A — EE Verified Domain Takeover
1. User enters `user@acme.com` on MSP sign-in.
2. Discovery resolves `acme.com` to a verified EE tenant claim.
3. Discovery enables only providers configured by that tenant.
4. Resolver enforces allow-list and uses tenant credentials.
5. OAuth callback proceeds using existing mapping behavior.

### Primary Flow B — EE Domain Not Eligible for Takeover
1. User enters email for a domain with claim state `pending`, `rejected`, `revoked`, or ambiguous ownership.
2. Discovery does not use tenant takeover.
3. Discovery returns app-level (Nine Minds) providers if configured.
4. Resolver uses app-level source only.

### Primary Flow C — CE Advisory Registered Domain
1. User enters email for a CE advisory-registered domain.
2. Discovery can use tenant/domain context (no ownership verification requirement).
3. Discovery enables eligible providers and resolver proceeds accordingly.

### Primary Flow D — Domain Not Registered in Either Edition
1. User enters email for unregistered/unresolved domain.
2. Discovery returns Nine Minds app-level provider availability.
3. Resolver uses app-level source if available.

### Primary Flow E — Credentials Login
1. User signs in with email/password.
2. Existing credentials flow remains unchanged.

## UX / UI Notes

1. MSP login keeps current layout in EE and CE.
2. SSO buttons remain disabled until a syntactically valid email is entered.
3. Eligible providers are controlled only by discovery response.
4. EE settings expose domain claim lifecycle with verification guidance and status.
5. CE settings expose advisory domain registration with clear copy that ownership verification is not enforced.
6. UX messaging for fallback should be neutral and non-enumerating.

## Requirements

### Functional Requirements

1. Support domain claim lifecycle states suitable for EE verification and CE advisory behavior.
2. Add EE-only domain verification challenge generation and validation workflow.
3. Allow EE tenant admins to request, verify, refresh, and revoke domain claims in settings.
4. Preserve existing tenant domain management capabilities while adding lifecycle metadata.
5. Apply conflict policy so only one EE tenant can hold an active verified takeover for a domain.
6. Update discovery logic to evaluate edition + claim lifecycle before enabling tenant takeover.
7. In EE, tenant takeover is allowed only for verified, non-ambiguous claims.
8. In CE, domain registration remains advisory (no verification gate), as a deliberate product rule.
9. For domains without eligible takeover, discovery returns app-level Nine Minds provider options.
10. Update CE MSP SSO login wiring to use discovery/resolver mechanism (not static/null SSO UI).
11. Keep discovery and resolver response contracts invariant and anti-enumerating.
12. Keep resolver allow-list enforcement and signed cookie checks intact with lifecycle-aware source validation.
13. Keep credentials login and client-portal auth behavior unchanged.
14. Preserve `/auth/msp/signin` route and callbackUrl passthrough behavior.

### Non-functional Requirements

1. Anti-enumeration: no pre-auth behavior may reveal specific user existence.
2. Security: EE ownership verification data must be signed/validated and never expose secrets.
3. Backward compatibility: existing tenants/domains continue functioning with explicit migration defaults.
4. Performance: discovery remains bounded and low-latency on login path.

## Data / API / Integrations

### Data model

Add lifecycle support to SSO login-domain persistence, including:
- Domain claim status (`advisory`, `pending`, `verified`, `rejected`, `revoked`, or equivalent normalized states)
- Verification metadata for EE claims (challenge id/token hash, verification timestamps, actor metadata)
- Conflict/ownership metadata needed to enforce single verified owner in EE

Optional supporting table may be introduced for domain verification challenges/history if needed.

### Endpoints / actions

1. Keep `POST /api/auth/msp/sso/discover` as the MSP pre-auth discovery endpoint.
2. Keep `POST /api/auth/msp/sso/resolve` as the gated resolver endpoint.
3. Add/extend settings server actions for:
- list claims
- request claim
- refresh challenge
- verify ownership (EE)
- revoke claim

### Provider routing policy

1. EE verified claim + tenant provider credentials => tenant-scoped provider routing.
2. EE non-verified/non-eligible claim => app-level Nine Minds provider fallback.
3. CE advisory registration may enable tenant-scoped routing; lack of advisory registration falls back to app-level.

## Security / Permissions

1. Only authorized internal admins can manage claims/verification in settings.
2. EE verification must prove domain control before takeover is marked verified.
3. Resolver must re-check eligibility at resolve time to avoid stale discovery escalation.
4. Discovery and resolver cookies remain signed, short-lived, httpOnly, sameSite-lax.

## Observability

Use existing structured logs for:
- discovery source (`tenant` vs `app`)
- claim lifecycle transition events
- resolver source selection outcomes

No new metrics/dashboard project is required in this phase.

## Rollout / Migration

1. Add schema migration for claim lifecycle and optional challenge storage.
2. Backfill existing domain rows to deterministic initial states:
- EE existing domains: `verified_legacy` (or equivalent verified-compatible status)
- CE existing domains: `advisory`
3. Keep `/auth/msp/signin` and existing links unchanged.
4. Roll out with EE/CE parity tests for discovery + resolver routing matrix.

## Open Questions

1. Should EE support automatic periodic re-verification for long-lived verified claims, or manual revoke/re-verify only in this phase?
2. For EE verified conflicts, should second claimant fail immediately at request time or only at verify time? (recommend fail at verify with neutral error and conflict context in admin UI)

## Acceptance Criteria (Definition of Done)

1. EE admins can request, verify, and revoke SSO domain claims.
2. CE admins can manage advisory domain registrations.
3. MSP login in EE and CE uses domain discovery to enable provider buttons.
4. EE tenant takeover occurs only for verified non-ambiguous claims.
5. CE advisory mode works without mandatory ownership verification.
6. Unmanaged/unapproved domains use Nine Minds app-level provider fallback.
7. Resolver enforces discovered allow-list and lifecycle-aware source eligibility with generic failures.
8. Credentials and client portal auth flows are unchanged.
9. `/auth/msp/signin` and callbackUrl passthrough remain compatible.
