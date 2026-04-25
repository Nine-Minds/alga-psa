# Microsoft Email Hosted OAuth Fallback

## Problem

Microsoft 365 inbound email OAuth currently requires a tenant Microsoft profile bound to the `email` consumer. Tenants that only configure or revoke MSP SSO login domains cannot use the included Nine Minds hosted Microsoft OAuth application, even though inbound email historically supported hosted/app-level credentials.

## Goals

- Restore the hosted Nine Minds Microsoft OAuth path for inbound email when no explicit Email Microsoft profile binding exists.
- Preserve explicit tenant-owned Microsoft email bindings when configured and ready.
- Keep MSP SSO login-domain claim state independent from inbound email OAuth behavior.
- Avoid falling back silently when an explicit Email binding exists but points to an invalid or incomplete profile.

## Non-goals

- Add/delete UI for MSP SSO login-domain claims.
- Change MSP SSO discovery behavior.
- Change calendar or Teams Microsoft profile resolution.
- Migrate existing Microsoft profiles or consumer bindings.

## Desired Behavior

1. Microsoft inbound email OAuth resolves credentials from the tenant's ready `email` Microsoft profile binding when present.
2. If no `email` binding exists, the resolver uses app-level hosted Microsoft email credentials from `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optional `MICROSOFT_TENANT_ID` app secrets or environment variables.
3. If an explicit binding exists but is invalid/archived/missing required secrets, the resolver fails with the binding error instead of hiding the misconfiguration.
4. Existing OAuth initiation, callback token exchange, and refresh-token flows all use the same resolver behavior.

## Acceptance Criteria

- A tenant without an Email Microsoft profile binding can initiate Microsoft inbound email OAuth when app-level hosted credentials are configured.
- A tenant with a ready Email Microsoft profile binding still uses that bound profile.
- A tenant with an invalid Email binding gets an invalid-profile error rather than fallback.
- Existing contract tests continue to prove runtime callers use the shared resolver and do not read Microsoft env vars directly.
