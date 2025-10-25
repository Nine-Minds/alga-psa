Title: Client Portal Tenant Deep Links Plan
Date: 2025-10-25

## Status – 2025-10-25
- **Draft**: Auth, email, and support stakeholders aligned on requirements; execution has not started.

## Overview / Rationale
- Canonical client-portal links currently rely on email + user type, which breaks when a contact belongs to more than one tenant.
- Adding a stable slug derived from the tenant UUID lets every canonical deep link carry tenant context without exposing internal IDs.
- Embedding tenant-specific links in outbound messages eliminates guesswork for recipients and keeps vanity-domain behaviour unchanged.

## Problem
- Client portal authentication only scopes by email + `user_type`, so duplicate emails across tenants collide during `signIn('credentials')`.
- Canonical links like `/auth/client-portal/signin` and `/client-portal/tickets` lack tenant hints, causing silent failures or cross-tenant access.
- Vanity domains infer tenant from the host, but canonical flows cannot distinguish tenants without user prompts or manual support intervention.

## Goals
- Require and persist an explicit tenant identifier for all canonical client-portal logins while keeping vanity-detected flows untouched.
- Generate tenant-scoped deep links across invitations, ticket updates, onboarding, and admin tooling using a shared helper.
- Provide a self-service recovery path (email capture ➝ tenant-specific email) that avoids exposing tenant membership in the public UI.
- Instrument errors and mismatches so support can detect broken links quickly.

## Non-Goals
- Building a public tenant-picker UI or exposing tenant rosters to unauthenticated visitors.
- Modifying MSP/internal authentication or replacing NextAuth/Auth.js infrastructure.
- Reworking OTT-based vanity handoffs or the portal domain provisioning workflow.

## Current State Snapshot
- `server/src/components/auth/ClientLoginForm.tsx` posts `signIn('credentials', { email, password, userType: 'client' })` without tenant info.
- `server/src/app/auth/client-portal/signin/page.tsx` renders `ClientPortalSignIn` and only derives branding/locale from vanity domains via `portalDomain`.
- `server/src/lib/actions/auth.tsx` → `authenticateUser` calls `User.findUserByEmailAndType` in `server/src/lib/models/user.tsx`, so canonical logins short-circuit on the first matching user.
- NextAuth configuration (`server/src/app/api/auth/[...nextauth]/options.ts`) stores `token.tenant` but never validates the tenant during the credentials flow.
- Email producers (`server/src/lib/actions/portal-actions/portalInvitationActions.ts`, `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`, `ee/temporal-workflows/src/activities/email-activities.ts`) assemble portal URLs manually and never append tenant context.
- `portal_domains` (20250919120000 migration) enforces a single vanity domain per tenant; canonical host lives in `canonical_host` but we do not surface slugs.
- OTT issuance/consumption for vanity domains (`server/src/app/api/client-portal/domain-session/route.ts`) already transports the tenant ID and should keep working untouched.

## Key Constraints & Considerations
- Slugs must be deterministic, short, and unique per tenant; collisions (while unlikely) need a regeneration pathway without changing the canonical tenant UUID. [ed: SKIP]
- Deep links must survive existing query parameters (`ticket`, `callbackUrl`, Temporal workflow params) without double-encoding.
- Temporal workers and background jobs rely on the same Postgres instance; any slug lookup helper must work in both the Next.js app and the worker runtime.
- New UI components must follow `docs/AI_coding_standards.md` (Radix-based primitives, deterministic component IDs).
- Avoid leaking tenancy information through error messages or network timing [ed: NETWORK TIMING ATTACK PREVENTION IS OVERKILL]; the recovery flow should only expose tenant names inside the authenticated email response. 

## Proposed Approach

### Phase 0 – Tenant Slug Foundations
- **Slug utility**: introduce a deterministic helper (e.g., `buildTenantPortalSlug(tenantId: string)`) that slices the tenant UUID into `${uuid.slice(0,6)}${uuid.slice(-6)}` (lowercase hex) and exposes reverse lookup via a lightweight repository wrapper.
- **Collision handling**: document the deterministic formula, add unit tests confirming uniqueness against fixture data, and provide a guardrail that logs (rather than stores) suspected collisions for manual follow-up.
- **Caching**: wrap slug lookups with `unstable_cache` (canonical host paths) and Temporal-side memoization so repeated calls avoid extra DB fetches.
- **Docs**: update `docs/client_portal_overview.md` to describe slug calculation, expected format, and the fact that slugs are derived on the fly rather than persisted.

### Phase 1 – Auth & Session Hardening
- **Client entrypoint**: update `server/src/app/auth/client-portal/signin/page.tsx` and `ClientPortalSignIn` to read `tenant` (slug) from `searchParams`, seed it into context, and pass through to `ClientLoginForm`.
- **Form payload**: extend `ClientLoginForm` to keep the slug in local state, include it in `signIn('credentials', { tenant: slug })`, and add hidden inputs/IDs respecting the reflection system.
- **NextAuth credentials provider**: modify `server/src/app/api/auth/[...nextauth]/options.ts` so `authorize` resolves the slug ➝ tenant ID, enforces tenant membership, and throws typed errors (`TENANT_MISSING`, `TENANT_MISMATCH`, `TENANT_UNKNOWN`).
- **Backend lookup**: add `User.findUserByEmailTenantAndType` in `server/src/lib/models/user.tsx` and update `authenticateUser` to require a tenant when `userType === 'client'` and the request targets the canonical host.
- **Session persistence**: ensure the JWT callback writes both `token.tenant` and `token.tenantSlug` (for downstream middleware/UI) and keep the session callback in sync.
- **Middleware**: tighten `server/src/middleware.ts` to append `tenant=<slug>` when redirecting canonical requests and to reject canonical sign-ins lacking a slug (they will fall through to the recovery flow in Phase 3).
- **Regression coverage**: add unit tests for the new model helper, credentials provider behaviour, and middleware enforcement; extend Playwright login specs with a slugged canonical scenario.

### Phase 2 – Deep Link Generation
- **URL helper**: create `server/src/lib/url/clientPortalUrls.ts` exporting `buildClientPortalUrl({ tenantId, path, query, preferVanity })` that picks vanity host when available, otherwise canonical host + `tenant=<slug>`.
- **Email touchpoints**:
  - Update `sendPortalInvitation` (`server/src/lib/actions/portal-actions/portalInvitationActions.ts`) to use the helper for setup URLs.
  - Update ticket notification subscriber (`server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`) to build portal links through the helper while preserving `ticket` params.
  - Extend Temporal email activities (`ee/temporal-workflows/src/activities/email-activities.ts`) to request the slug via a lightweight REST endpoint or shared DB call (add service wrapper if direct DB access is unavailable).
  - Audit other templates (`server/src/lib/email/*`, Temporal workflows) for `/auth/client-portal/` references and migrate them to the helper.
- **Admin tooling**: add a “Copy portal login link” action in `server/src/components/settings/general/UserManagement.tsx` (client portal tab) that calls a new server action returning the slugged URL; ensure button IDs follow the standards (e.g., `copy-client-portal-link-button`).
- **Portal domain guardrails**: ensure `getPortalDomain` returns both vanity domain metadata and tenant ID so helper calls can compute the slug without duplicated lookups.

### Phase 3 – Canonical Recovery Flow & UX
- **UI flow**: when `/auth/client-portal/signin` lacks `tenant`, render a new `ClientPortalTenantDiscovery` component prompting for email only (ID: `tenant-discovery-form`).
- **Server action**: implement `requestTenantLoginLinksAction(email)` that:
  - Normalizes email and finds all client users across tenants via the new lookup helper.
  - Sends a branded email (new template under `server/src/lib/email/clientPortalTenantRecoveryEmail.ts`) listing one or more tenant-specific login links (vanity if active, canonical + slug otherwise).
  - Records audit logs / rate limits to prevent abuse (e.g., store last request in `tenant_recovery_requests` table or reuse notification logs).
- **Email content**: localize strings, ensure links include slug, and include fallback instructions when no tenant is found.
- **Security**: return a generic “Check your email” toast regardless of matches to avoid account enumeration; throttle repeated submissions per IP/email.
- **Callback handling**: preserve `callbackUrl` in generated links (store in the email payload, append to the query when present).

### Phase 4 – Telemetry, Docs & Rollout
- **Logging**: add structured logs + PostHog events for `tenant_slug_missing`, `tenant_mismatch`, recovery email sends, and recovery throttling.
- **Documentation**: update `docs/client_portal_overview.md` and relevant runbooks to describe slug usage, helper APIs, and how to diagnose slug collisions or mismatch reports.
- **Feature flag & rollout**: gate slug enforcement behind an env flag (e.g., `CLIENT_PORTAL_REQUIRE_TENANT_SLUG`) for staged rollout; enable in staging first, monitor, then production.
- **Cleanup**: once stable, remove temporary logging noise and finalise TODO comments.

## Testing & Rollout
- **Unit**: cover slug helper, user lookup, NextAuth authorize callback, middleware redirect logic, URL builder permutations.
- **Integration**: expand Playwright suites (`client-portal-login-e2e`, `client-portal-vanity-session`, `client-portal-redirects`) with slugged canonical runs and recovery email flow (mock provider).
- **Email snapshots**: add Jest snapshots for invitation/ticket/recovery emails to confirm the correct host + `tenant` query.
- **Temporal**: add activity tests ensuring the helper resolves vanity vs canonical correctly when running in the worker.
- **Monitoring**: verify dashboards post-deploy for login failures segmented by error reason; add alert thresholds for sustained `tenant_mismatch` spikes.

## Observability & Support
- Surface slug + tenant ID in support tooling (e.g., add to `server/src/components/contacts/ContactPortalTab.tsx`) so agents can copy canonical links quickly.
- Add Kibana/PostHog dashboards tracking recovery email volume, mismatches, and suspected slug collisions (duplicate computations for the same tenant ID).
- Update runbooks so support teams know how to validate the computed slug, confirm tenant membership, and invalidate caches when slug discrepancies are reported.

## Acceptance Testing
- **Canonical slug flow**: use an invite/welcome email, ensure login succeeds, session includes correct tenant/slug, and return paths honour `callbackUrl`.
- **Canonical recovery**: visit `/auth/client-portal/signin` without slug, submit an email:
  - Single-tenant email delivers one slugged link that logs in successfully.
  - Multi-tenant email yields one link per tenant with appropriate branding.
  - Unknown email still shows the generic confirmation while delivering a “not found” message.
- **Vanity domain**: confirm vanity-host login bypasses slug requirement, OTT handoff still works, and discovery form remains hidden.
- **Admin tooling**: copy-link action returns vanity URL when configured, otherwise canonical host + slug, and the link logs in correctly.
- **Regression**: rerun existing Playwright journeys plus any new tests introduced above.

## Open Questions
- Do we need an ops-facing flow to handle rare slug collisions (e.g., temporarily overriding the slug helper for affected tenants)?
- Should recovery emails include tenant logos/branding pulled from `tenant_settings.settings.branding` for better recognition?
- Can we rely on direct DB reads from Temporal, or do we need a small internal API endpoint to fetch slug + vanity metadata?
