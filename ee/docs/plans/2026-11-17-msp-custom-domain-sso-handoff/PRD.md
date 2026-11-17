# PRD: MSP custom-domain SSO through the canonical host

- Status: Draft
- Owner: Robert Isaacs
- Created: 2026-11-17
- PSA tickets: alga-2026-0002996 (report), alga-2026-0002799 (original MSP custom-domain work, PR #3862)

## Summary

Run Google, Microsoft and Keycloak sign-in for the MSP app on the canonical host
(`NEXTAUTH_URL`) and hand the session to the tenant's custom domain with the
one-time-token (OTT) handoff the client portal already uses. Custom domains
then never need their own OAuth callback URIs, so the `pending_redirect_uri`
activation gate, its confirmation action and its settings panel are removed.
A domain that serves the MSP app goes active as soon as DNS and HTTPS are
ready, the same as a client-portal domain.

## Problem

PR #3862 made a custom domain able to serve the MSP app (surface `msp` or
`both`). It runs NextAuth in place on the custom host
(`packages/auth/src/nextauth/customHostAuth.ts`), so the identity provider
redirects to `https://<custom-domain>/api/auth/callback/<provider>`. Every
provider app that can sign in on the domain must list that URI, so #3862 added
a gate: the domain stays `pending_redirect_uri` until someone confirms the URIs
are registered.

That gate does not work on hosted:

- The required URIs belong to the platform's own Google and Microsoft apps
  (`GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`), which only Nine Minds can edit.
- `confirmPortalDomainRedirectUrisAction` refuses hosted domains ("registered by
  platform support"), and no staff tool records the confirmation.
- `checkPortalDomainDeploymentStatus` treats `pending_redirect_uri` as terminal,
  so Refresh never re-evaluates it.
- The status message tells the tenant to register the URIs "with your identity
  provider(s)", so tenants edit their own apps, which changes nothing.
- Nothing ever checks a provider console; "confirmation" is an attestation.

Every hosted domain that serves the MSP app is therefore stuck, and fixing one
means hand-editing the shared provider apps per customer domain. That does not
scale: both providers cap the number of redirect URIs per app, and the manual
step is easy to forget. On appliances the operator must register URIs per
domain on every provider app as well.

The client portal never had this problem: its SSO always completes on the
canonical host and the session is handed off (`computeVanityRedirect` →
`issuePortalDomainOtt` → `/auth/client-portal/handoff` →
`/api/client-portal/domain-session`). The handoff only refuses MSP users
because `computeVanityRedirect` filters on `isClientUserType`.

## Goals

- OAuth sign-in for the MSP app on a custom domain completes on the canonical
  host; the only redirect URIs any provider app needs are the canonical host's.
- After OAuth, an internal user whose sign-in started on a custom MSP domain
  lands on that domain, signed in, on the page they asked for.
- One handoff mechanism serves both client and internal users.
- A custom domain serving `msp` or `both` goes active once DNS and HTTPS are
  ready, on hosted (Temporal) and appliance (direct) provisioning alike.
- Domains stuck in `pending_redirect_uri` today become active without tenant
  action.
- The redirect-URI gate, its confirmation action, its settings panel, its
  status message and `PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED` are gone.

## Non-goals

- Changing password sign-in on a custom MSP domain. It already runs in place
  with tenant binding (`bindAuthConfigToTenant`) and involves no provider.
- Single sign-on across hosts: a technician signed in on the canonical host is
  not automatically signed in on the custom domain (or vice versa) unless they
  go through sign-in.
- Main-host links still built by password reset, team invites and appointment
  emails (the known gaps listed in #3862).
- Client-portal SSO; it already works this way.

## Users and primary flows

Personas: an MSP technician or admin signing in to the MSP app on their
company's custom domain; the tenant admin setting up the domain.

### Flow A: SSO sign-in on a custom MSP domain

1. The technician opens `https://<custom-domain>/msp/...` and is sent to the
   sign-in page on that host (unchanged).
2. They choose Google, Microsoft or Keycloak (or enter an email that resolves
   to SSO). One click takes the browser to the canonical host, which runs SSO
   resolution and starts the OAuth request there. The provider sees the
   canonical `redirect_uri`.
3. The provider returns to the canonical callback. The canonical host checks
   that the requested custom domain is active, serves the MSP app and belongs
   to the signed-in user's tenant, then issues an OTT and redirects to the
   custom domain's handoff page.
4. The handoff page exchanges the OTT, sets the session cookie on the custom
   host and sends the user to the page they asked for under `/msp`.

### Flow B: domain setup

The admin enters the domain, picks what it serves and adds the CNAME. Once DNS
verifies and HTTPS is ready, the domain is active. There is no redirect-URI
step, panel or confirmation button for any surface.

### Flow C: failures

- If the custom domain is not active, does not serve the MSP app, or belongs
  to another tenant, no OTT is issued and the user stays signed in on the
  canonical host (today's fallback behaviour).
- An expired, reused or wrong-domain OTT shows the existing handoff error with
  a link back to sign-in.

## UX / UI notes

- The SSO buttons on a custom MSP host look the same; the only visible change
  is that the browser passes through the canonical host during sign-in, as the
  client portal already does.
- Remove the redirect-URI panel, the confirm button and their locale keys from
  `ClientPortalDomainSettings.tsx`. Remove `pending_redirect_uri` from the
  status badge map once no row can hold it.

## Technical design

### Starting OAuth on the canonical host

`SsoProviderButtons` currently calls the SSO resolve endpoint and `signIn()` on
the current host. The OAuth state, PKCE and CSRF cookies are host-only, so the
whole round trip must start and end on the canonical host. On a custom MSP
host the buttons navigate (one top-level navigation) to a canonical entry
point that takes the provider, optional email, the target custom domain and
the return path, runs the same resolution the resolve endpoint does, and
starts the OAuth request. The canonical entry point is the only place that
starts OAuth for a custom host. On the canonical host itself behaviour is
unchanged.

### Handoff for internal users

Generalise the client-portal handoff into one surface-neutral handoff:

- `computeVanityRedirect` (`packages/auth/src/lib/nextAuthOptions.ts`) accepts
  internal users when the callback target's host is an active domain of the
  user's tenant that serves the MSP app and the return path is an MSP path.
  Client users keep the current rule (`isClientPortalHandoffDomain`). The
  surface check generalises: the domain must serve the surface of the return
  path.
- `issuePortalDomainOtt` is unchanged apart from carrying the surface.
- The handoff page and exchange route serve both surfaces. The default
  redirect depends on the user type (`/msp/dashboard` for internal users,
  `/client-portal/dashboard` for client users), and the exchange refuses a
  return path for a surface the domain does not serve.
- The session token minted by the exchange must be the token a direct sign-in
  produces for that user. Build it with the same function the `jwt` callback
  uses on sign-in (tenant, user type, subscription/plan claims, session id,
  login method, and anything added later), not from a per-surface field list
  copied into the OTT snapshot. The client-portal path moves to the same
  function.
- Tenant binding stays: the exchange refuses an OTT whose tenant does not own
  the domain, and the custom host's in-place auth keeps
  `bindAuthConfigToTenant`.

### Removing the redirect-URI gate

- Provisioning: `directProvisioner.ts` and the Temporal activity
  `checkPortalDomainDeploymentStatus` set `active` once HTTPS and routing are
  ready, for every surface. `temporalProvisioner.ts` and
  `portalDomainActions.ts` stop writing `verification_details.sso_redirect_uris`.
- Delete `server/src/lib/portal-domains/ssoRedirectUris.ts`,
  `confirmPortalDomainRedirectUrisAction`, the gate helpers in
  `shared/core/portalDomainSurface.ts` (`getRequiredSsoRedirectUris`,
  `readSsoRedirectUriState`, `evaluateSsoRedirectUriGate`), the
  `ssoRedirectUris` field on the status type, and the
  `PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED` env flag.
- `pending_redirect_uri` stays in the Postgres enum (dropping an enum value is
  not worth the risk) but is dropped from the TypeScript status unions and
  from the registration workflow's terminal set once the data migration has
  run.

### Data migration

A base migration sets `status = 'active'` (with the standard "live" status
message) for every `portal_domains` row in `pending_redirect_uri`, and strips
`verification_details.sso_redirect_uris`. A row only reaches that status after
the gateway and virtual service exist, so it is ready to serve. The update is
a multi-shard `UPDATE` on a distributed table; keep it free of `now()` inside
`CASE`/`COALESCE` (bind the timestamp).

### Edition

Portal domains and the auth handoff live in CE packages (`packages/auth`,
`server/src/lib/portal-domains`); hosted provisioning lives in `ee/`. Nothing
here is Pro-only, so the base migration goes in `server/migrations` and no
edition-specific behaviour is introduced.

## Risks

- Session parity: if the exchanged token lacks a claim a direct sign-in sets,
  some MSP feature misbehaves only on custom domains. The shared minting
  function is the mitigation; the exchange test asserts parity.
- Open-redirect / cross-tenant handoff: the canonical host must issue an OTT
  only for an active domain of the signed-in user's tenant that serves the
  return path's surface.
- The OAuth round trip leaves a session cookie on the canonical host as well
  as the custom host, as the client portal does today. Signing out on the
  custom host does not end the canonical session.

## Rollout

- Ship the code and the data migration together. Hosted domains stuck in
  `pending_redirect_uri` become active on deploy; their technicians can then
  sign in on the custom domain with platform Google/Microsoft SSO.
- Appliance operators who registered per-domain callback URIs can leave or
  remove them; they are no longer used.
- Remove `PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED` from deploy config if
  it is set anywhere (`~/nm-kube-config`, appliance charts).

## Open questions

- Should the canonical session created during the round trip be ended once the
  handoff succeeds? Default: keep today's client-portal behaviour.

## Acceptance criteria

- On a hosted or appliance install, a domain serving `both` goes active once
  HTTPS is ready, with no confirmation step.
- An internal user clicking Google or Microsoft on the custom domain's sign-in
  page completes OAuth with the canonical `redirect_uri` and ends on the custom
  domain under `/msp`, signed in, with a session equivalent to a canonical
  sign-in.
- A user of another tenant, or a target domain that is inactive or does not
  serve the MSP app, gets no handoff.
- Client-portal SSO and handoff behave as before.
- After migration no `portal_domains` row is `pending_redirect_uri`, and no
  code references the redirect-URI gate.
