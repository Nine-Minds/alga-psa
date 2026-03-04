# MSP SSO Domain Claims and Routing

This guide describes how MSP SSO domain-based routing works for Enterprise Edition (EE) and Community Edition (CE), including ownership verification and fallback behavior.

## EE Domain Takeover Lifecycle (Request, Verify, Revoke)

In EE, a tenant can only take over SSO routing for a domain after ownership verification succeeds.

1. Open `Settings -> Integrations -> Providers`.
2. In the MSP SSO domain claims section, request a claim for your domain (for example `acme.com`).
3. Copy the DNS TXT challenge value shown by the UI.
4. Publish the TXT record at your DNS provider using the host/key shown in the UI.
5. Wait for DNS propagation, then run Verify from the same claim row.
6. After verification succeeds, claim status becomes `verified` and tenant-scoped Google/Microsoft provider eligibility is used for that domain.
7. If you need to remove takeover eligibility, use Revoke. The claim transitions to `revoked` and routing falls back to app-level provider readiness.

Operational notes:
- Pending, rejected, revoked, or ambiguous claims do not activate tenant takeover in EE.
- Resolver re-checks eligibility at resolve-time, so stale pre-auth discovery context cannot force unauthorized tenant takeover.

## CE Advisory Domain Registration

In CE, domain registration is advisory and does not require ownership proof.

1. Open `Settings -> Integrations -> Providers`.
2. Add or remove domains in the MSP SSO advisory domain list.
3. Save changes.

Behavior notes:
- Advisory registrations can enable tenant-scoped provider routing when tenant credentials exist.
- Ownership verification is intentionally non-blocking in CE for this phase.
- Removing an advisory registration makes the domain ineligible for tenant routing and discovery falls back to app-level providers.

## App-Level Fallback (Nine Minds Standard Providers)

When a domain is unmanaged/unregistered, ambiguous, or ineligible for tenant takeover, discovery resolves against app-level fallback provider availability.

Fallback prerequisites:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`
- `MICROSOFT_OAUTH_CLIENT_SECRET`

If fallback credentials are configured, eligible app providers are returned by discovery and can be used by resolver/start flow. If not configured, provider buttons remain disabled.

## Security and UX Contracts

- Discovery and resolve responses preserve anti-enumeration semantics and do not expose user existence.
- Discovery and resolution cookies are signed, short-lived, and do not contain OAuth client secrets.
- MSP credentials sign-in and client portal auth flows remain unchanged by domain claim lifecycle behavior.
