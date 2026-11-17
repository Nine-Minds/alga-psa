# Scratchpad: MSP custom-domain SSO through the canonical host

## Decisions

- 2026-11-17 (Robert): replace the redirect-URI gate with a canonical-host OAuth round trip plus OTT handoff, rather than adding a staff tool to confirm URIs per domain. Per-domain URI registration on the platform's shared Google/Microsoft apps does not scale (provider caps on redirect URIs per app, manual step easily missed) and the gate is attestation-only anyway.
- Password sign-in on the custom host stays in place (customHostAuth + bindAuthConfigToTenant); only OAuth moves to the canonical host.
- Keep `pending_redirect_uri` in the Postgres enum; drop it from TS unions after the data migration.

## Discoveries

- Gate origin: PR #3862 (alga-2026-0002799). In-place auth for MSP-serving hosts: `packages/auth/src/nextauth/customHostAuth.ts` (next-auth rewrites origins to NEXTAUTH_URL, so @auth/core is run directly on the rebased request).
- Gate pieces: `server/src/lib/portal-domains/ssoRedirectUris.ts` (resolveSsoProvidersForTenant, confirmViaAutomation, buildSsoRedirectUriState), `shared/core/portalDomainSurface.ts` (getRequiredSsoRedirectUris, readSsoRedirectUriState, evaluateSsoRedirectUriGate), `server/src/lib/portal-domains/provisioner/directProvisioner.ts`, `ee/server/src/lib/portal-domains/provisioner/temporalProvisioner.ts`, `ee/temporal-workflows/src/activities/portal-domain-activities.ts` (~line 720, status message), `ee/temporal-workflows/src/workflows/portal-domains/registration.workflow.ts` (terminal set), `server/src/lib/actions/tenant-actions/portalDomainActions.ts` (confirmPortalDomainRedirectUrisAction, refuses non-direct mode), `server/src/components/settings/general/ClientPortalDomainSettings.tsx` (panel + button), locale keys in `server/public/locales/*/msp/settings.json`.
- On hosted, `checkPortalDomainDeploymentStatus` treats pending_redirect_uri as terminal and returns it unchanged, so Refresh never re-evaluates.
- Client-portal handoff: `computeVanityRedirect` in `packages/auth/src/lib/nextAuthOptions.ts` (filters `isClientUserType`; domain check `isClientPortalHandoffDomain`), `issuePortalDomainOtt`/`consumePortalDomainOtt` in `packages/auth/src/lib/PortalDomainSessionToken.ts` (table portal_domain_session_otts, 90 s TTL, requires domain active and hostname match), page `server/src/app/auth/client-portal/handoff/page.tsx`, client `packages/auth/src/components/PortalSessionHandoff.tsx`, exchange `server/src/app/api/client-portal/domain-session/route.ts` (encodes a session from `userSnapshot`, default redirect /client-portal/dashboard, sanitizeReturnPath only checks a leading '/').
- The MSP jwt callback (nextAuthOptions.ts ~2103) sets subscription claims (plan, product_code, addons, trial_end, subscription_status, solo_pro_trial_end, effectiveTier, last_plan_check) and proToken that the client OTT snapshot does not carry. Hence the shared minting function.
- `SsoProviderButtons.tsx` calls the resolve endpoint (`/api/auth/msp/sso/resolve`, sets host-only resolution cookies, MSP_SSO_RESOLUTION_COOKIE) and then signIn() on the current host. Both must happen on the canonical host for a custom MSP host.
- #3862's smoke test ran in direct/appliance mode with the fake Google provider only; hosted/Temporal provisioning and real providers were never exercised.

## Gotchas

- Citus: the data migration is a multi-shard UPDATE on distributed `portal_domains`; bind the timestamp rather than using now() inside CASE/COALESCE.
- The OAuth state/PKCE/CSRF cookies are host-only: OAuth must start and end on the same (canonical) host.
- The fake Google authorize endpoint runs on NEXTAUTH_URL, which suits the new flow for E2E.

## Commands

- Read a domain's gate state (prod, read-only): `SELECT domain, status, surface, verification_details->'sso_redirect_uris' FROM portal_domains WHERE status = 'pending_redirect_uri';`
