# Multi-Provider SSO Integration Plan

## Overview
- Deliver Google Workspace and Microsoft 365 SSO that fits the existing multi-tenant NextAuth.js stack without disrupting current credential flows.
- Normalize identity data across providers so tenant routing, OTT vanity handoff, and user_type logic continue to function uniformly.
- Provide a guided migration path that lets password-based users link SSO identities safely and allows ops to monitor and enforce adoption by tenant.

## Phased Technical Plan

### Phase 0 – Foundations and Provider Enablement
- [ ] Provision Azure AD enterprise app, confirm Google OAuth project, and capture client IDs, secrets, tenant IDs, and redirect URIs.
- [x] Update secret loader so Microsoft OAuth values (client ID, secret, authority/tenant) are available alongside Google via `getNextAuthSecret`.
- [x] Add Microsoft provider configuration (e.g., `AzureADProvider`) and refresh Google provider options to share the common claim extractor.
- [x] Refresh `.env.example`, devbox/dev compose templates, and developer docs to include both providers for local testing.
- [x] Document OAuth secrets and redirect URIs in EE configuration guides while leaving CE `.env.example` entries absent or commented.
- [x] Wrap provider registration in `server/src/app/api/auth/[...nextauth]/options.ts` with the existing `isEnterprise` guard so CE builds resolve to stubs.

### Phase 1 – Provider Integration and Claim Normalization
- [x] Implement a shared profile mapper that converts Google and Microsoft payloads into the `ExtendedUser` schema.
- [x] Extend `signIn` and `jwt` callbacks to apply tenant resolution from query `tenant_hint`, vanity-domain headers, or email-domain heuristics when provider data is incomplete.
- [x] Invoke existing user validation (active status, tenant membership, user_type) within the OAuth callback before token issuance.
- [x] Confirm `session` and `redirect` callbacks read normalized claims so OTT and redirect flows behave consistently across providers.
- [x] Place provider adapters, claim mappers, and account-link helpers in `ee/server/src/lib/auth/ssoProviders.ts` with matching stubs in `server/src/empty/lib/auth/ssoProviders.ts`.

### Phase 2 – Account Linking and Migration Path
- [x] Create or extend a `user_auth_accounts` table keyed by user ID and provider (google|microsoft) with provider subject IDs and metadata.
- [x] Deliver an authenticated “Connect SSO” flow that revalidates password and TOTP before capturing OAuth provider details.
- [ ] Update credential login surfaces to detect linked providers, show migration prompts, and suppress local 2FA prompts after successful OAuth login (tenant configurable).
- [ ] Build a batch backfill script for federated email domains and log unresolved accounts for manual review.
- [x] Store schema migrations for the new linking table under `ee/server/migrations` and supply CE no-op stubs.
- [x] Serve SSO buttons and the “Connect SSO” settings page from `@ee` components/pages with CE stubs in `server/src/empty`.

### Phase 3 – Rollout, Monitoring, and Policy Controls
- [ ] Introduce feature flags or configuration to enable SSO providers per tenant/portal for controlled rollout.
- [ ] Instrument telemetry to capture provider usage, OTT handoffs, migration completions, and repeated password fallbacks.
- [ ] Add policy controls allowing tenants to require SSO and to determine whether local TOTP remains after OAuth logins.
- [ ] Publish operational runbooks covering break-glass password resets, tenant onboarding checklists, and SSO troubleshooting.
- [ ] Update `scripts/build-enterprise.sh`, validate CE Docker builds resolve `@ee` imports to stubs, and gate new OAuth integration tests behind `process.env.EDITION === 'enterprise'`.

## Background and Investigational Notes

### Existing Authentication Architecture
- **Tech stack**: NextAuth.js with JWT strategy (configurable `SESSION_MAX_AGE`), custom session cookies, on-demand user validation per request.
- **Providers in place**: Google OAuth using `GoogleProvider`; Keycloak integration via `KeycloakProvider`; custom credentials provider with password + 2FA.
- **User portals**: Internal MSP staff sign in at `/auth/msp/signin` (`user_type: internal`); client users sign in at `/auth/client-portal/signin` (`user_type: client`, with `clientId` and `contactId` requirements).
- **Core files**: NextAuth handler (`server/src/app/api/auth/[...nextauth]/route.ts`), options (`.../options.ts`), credential logic (`server/src/lib/actions/auth.tsx`), registration/reset, session cookies, and portal-specific forms.
- **JWT/session callbacks**: `signIn` tracks last login and client redirects; `jwt` populates claims (id, email, tenant, user_type); `session` turns tokens into session objects; `redirect` routes users by `user_type`.
- **Client portal handoff**: Vanity domain redirect uses OTT tokens via `computeVanityRedirect` and `PortalSessionHandoff.tsx`.

### Credentials Flow Snapshot
- Email/password checked against database hashed password.
- 2FA enforced when `two_factor_enabled` using TOTP codes (passed as `twoFactorCode`).
- JWT issued with tenant and user metadata; session callback mirrors data; redirect logic handles portal selection.

### OAuth Flow Snapshot
- User triggers provider button; profile callback runs.
- **Google**: Currently requires existing DB user by email and verifies active status; assigns default `user_type` (internal).
- **Keycloak**: Accepts profile data with tenant/user_type claims.
- Once profile is accepted, standard JWT/session callbacks run.

### Investigation Takeaways Relevant to Plan
- Need consistent claim normalization so OTT and redirect logic remain unchanged across providers.
- Tenant determination for OAuth logins is currently limited; must combine query hints, vanity headers, or email-domain mapping.
- 2FA bypass expectations differ by provider; policy controls will decide whether to trust external 2FA or enforce local TOTP post-login.
- Account linking is required to prevent duplicate user records and to let existing credential users migrate smoothly.
- Future enhancements may include auto-provisioning (SCIM/Azure AD) and Google auto-provisioning; plan leaves hooks for these but focuses on core SSO enablement.
