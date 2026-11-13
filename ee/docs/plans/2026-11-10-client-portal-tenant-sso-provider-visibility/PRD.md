# PRD — Client portal sign-in: show only the SSO providers the tenant offers

- Slug: `client-portal-tenant-sso-provider-visibility`
- Date: `2026-11-10`
- Status: Draft
- Source: AlgaPSA ticket alga-2026-0002989

## Summary

The client portal sign-in page shows a button for every SSO provider the deployment has configured. On hosted Enterprise Edition that means "Sign in with Google" and "Sign in with Microsoft" for every tenant, whatever the MSP's clients actually use. This plan adds one tenant setting, the list of SSO providers the tenant's client portal offers, to the existing Sign-in policy card. Client portal sign-in shows exactly the intersection of that list with the providers that can actually sign in for the tenant, and the server enforces the same list. When no list is saved, the portal behaves exactly as it does today.

In the same PR, the duplicated `SsoProviderButtons` component (a shared copy plus an EE copy that differs only in comments) collapses to one file. Otherwise this change would have to be made twice.

## Problem

- The client portal knows its tenant before sign-in (`?tenant=` slug, or the vanity portal domain resolved through `portal_domains`), but the SSO buttons ignore that.
- On hosted EE the platform has app-level credentials for Google and Microsoft. Today's availability rule is "tenant credentials **or** app credentials" per provider (`discoverClientPortalSsoProviders`). That rule is always true on hosted, so every tenant shows both buttons.
- Before an email is typed, the buttons come from the NextAuth provider registry (`/api/auth/providers`), which is deployment-wide. Per-email discovery only enables or disables a button and never hides one.
- Client users then pick a provider the MSP does not use. For example, they try a personal Google account on a portal whose clients are all on Microsoft 365. The attempt fails with a confusing mapping error, which turns into support tickets.

Why "tenant credentials only" cannot be the rule: client-portal SSO matches the IdP-presented email to an active `user_type='client'` user in the tenant named by the signed resolution cookie. It does not need tenant-owned credentials. Most hosted tenants offer SSO to their clients **through the platform app**. A rule of "only providers with tenant credentials" would silently take SSO away from them. The tenant's intent cannot be derived from what is configured, so the tenant has to state it.

## Goals

1. An MSP admin can choose which SSO providers their client portal offers, as one list in Settings → Security → Single Sign-On → Sign-in policy.
2. The client portal sign-in page renders only the offered providers, from the first server render, with no flash of other providers.
3. The server enforces the same list. Discovery never offers, and resolve never accepts, a provider outside it.
4. Tenants that never save the setting see no change.
5. One `SsoProviderButtons` implementation instead of two copies that must be edited together.

## Non-goals

- MSP sign-in (`/auth/msp/signin`) provider visibility. The MSP page is on a shared domain and the tenant is unknown until an email is typed. See Open Questions.
- Changing how a client user is matched (email to active client user in the resolved tenant), account linking, or `autoLinkClient`.
- Adding new SSO providers or per-client (per-customer-company) provider lists.
- Hiding the password form, or "SSO-only" for client users. The login policy says the SSO requirement never applies to client users, and that stays true.
- Changing the client-portal discovery request shape (it still needs an email to mint the signed discovery cookie).

## Users and Primary Flows

**MSP admin (Security settings permission):**
1. Opens Settings → Security → Single Sign-On.
2. In the Sign-in policy card, under "Client portal sign-in options", sees one checkbox for each SSO provider that can sign in for this tenant (Google, Microsoft, Keycloak). Unless a list has been saved, all are checked.
3. Unchecks Google. The change saves immediately, like the other controls in the card, and the change is audited (`LOGIN_POLICY_CHANGED`).

**Client portal user:**
1. Opens the portal sign-in page (vanity domain or `?tenant=` slug).
2. Sees the password form and only the "Sign in with Microsoft" button.
3. Types their email. The button enables once discovery answers, and sign-in proceeds exactly as today.

## UX / UI Notes

- Location: the existing `LoginPolicySettings` card (EE, Security → Single Sign-On tab). It already holds client-user policy ("Require two-factor authentication for client portal password sign-in"). No new card, tab or page.
- Control: a labelled group of `Checkbox` components (`@alga-psa/ui/components/Checkbox`), one per available provider. This is the same standard component the card already uses for break-glass administrators. The checkboxes edit one list. They are not separate per-provider flags.
- Checked state = provider is in the effective offered list. With no saved list, every available provider is checked.
- Providers that cannot sign in for the tenant (no tenant and no app credentials) are not listed. If none are available, show a muted line ("No single sign-on providers are configured...") instead of the checkboxes.
- Unchecking every box is allowed and means "no SSO buttons on the client portal". Password sign-in is unaffected.
- Stable element ids: `login-policy-client-portal-sso`, `login-policy-client-portal-sso-{google|azure-ad|keycloak}`, `login-policy-client-portal-sso-none`.
- All new copy goes under `loginPolicy.clientPortalSso.*` in `msp/settings` for every locale (en, de, es, fr, it, nl, pl, pt, sv + pseudo xx, yy). Provider labels use translation keys. They do not reuse the English names hard-coded in `providerConfig.ts`.
- The card description says "how staff and client portal users may sign in with a password". Reword it so it also covers the SSO options.
- Sign-in page: no visual change other than which buttons appear. With an empty offered list, the SSO block renders nothing.

## Requirements

### Functional Requirements

**Policy model (pure, `packages/auth/src/lib/authPolicy.ts`)**
- FR1: `TenantAuthPolicy` gains `clientPortalSsoProviders: SsoProviderId[] | null`, stored at `tenant_settings.settings.sso.clientPortalSsoProviders`. `null` (absent) means "offer every available provider" (today's behavior). An array means exactly these providers, and `[]` means none.
- FR2: `normalizeTenantAuthPolicy` tolerates junk. A non-array becomes `null`. An array keeps only supported provider ids, deduplicated, in canonical order (`google`, `azure-ad`, `keycloak`).
- FR3: `applyPolicyChange` carries the field through. `undefined` in the update keeps the previous value, and an explicit value replaces it.
- FR4: `validatePolicyChange` rejects a requested list that contains an unsupported provider id, with guard code `client_portal_sso_provider_invalid` (fail fast; never silently drop client input on save).
- FR5: A pure `offeredClientPortalSsoProviders(available, policy)` returns `available` when the list is `null`, otherwise `available ∩ list`, in canonical order.

**Provider ids (single pure source)**
- FR6: The supported provider id list, its type and `isSupportedProvider` move to the pure `packages/auth/src/lib/sso/types.ts`. `mspSsoResolution.ts` re-exports them so existing imports keep working, and `authPolicy.ts` stays free of server imports.

**Availability and discovery (`packages/auth/src/lib/sso/clientPortalSsoResolution.ts`)**
- FR7: `listClientPortalAvailableSsoProviders(tenantId)` returns, on EE, each provider for which the tenant has its own credentials **or** the app has fallback credentials. That covers all three providers, so a tenant-owned Keycloak realm now counts. On CE it returns `[]` (unchanged).
- FR8: `discoverClientPortalSsoProviders(tenantId)` returns `offeredClientPortalSsoProviders(available, loadTenantAuthPolicy(tenantId))`. The discover route is unchanged, but its signed cookie, and so the resolve route, now only carry offered providers. That makes the setting server-enforced.
- FR9: `getClientPortalSignInSsoProviders({ tenantSlug, portalDomain })` resolves tenant context with the existing `resolveClientPortalSsoTenantContext` and returns the offered list. If anything fails it returns `[]` and logs a warning, so the password form still works.

**Sign-in page**
- FR10: `server/src/app/auth/client-portal/signin/page.tsx` calls FR9 server-side, using the tenant it has already resolved, and passes the list down `ClientPortalSignIn` → `ClientLoginForm` → `SsoProviderButtons` as `offeredProviders`.
- FR11: `SsoProviderButtons`: when `offeredProviders` is supplied, the visible set is the edition set ∩ `offeredProviders`. The component does not fetch `/api/auth/providers`, and the first render already shows the final set. Per-email discovery still decides enabled/disabled. With no `offeredProviders` (the MSP surface), behavior is unchanged.

**Settings**
- FR12: `LoginPolicyState` gains `availableClientPortalSsoProviders: SsoProviderId[]` (from FR7). `getLoginPolicyAction` and `updateLoginPolicyAction` return it, and `LoginPolicyUpdate` accepts `clientPortalSsoProviders`.
- FR13: The `LoginPolicySettings` card renders the checkbox group (UX notes). Toggling a box saves the full resulting list, computed from the effective checked set, through `updateLoginPolicyAction`. On failure the control reverts and shows the existing error or guard alert.
- FR14: `saveTenantAuthPolicy` persists the whole normalized policy object into `settings.sso`. The current hand-enumerated field list would otherwise need a fourth edit for every new field. The existing `LOGIN_POLICY_CHANGED` audit records before/after including the new field.
- FR15: The CE stubs (`packages/ee/src/lib/actions/auth/loginPolicy.ts`) mirror the new state and update types. The CE settings component stays `null`.

**Component de-duplication**
- FR16: Delete `ee/server/src/components/auth/SsoProviderButtons.tsx`. `@alga-psa/auth/sso/entry` resolves to `packages/auth/src/components/SsoProviderButtons.tsx` in both editions. That means removing the EE branch from both alias blocks in `server/next.config.mjs`, the EE rewrite in its webpack resolve plugin (`authSsoButtonsEeEntry`), and the alias in `ee/server/next.config.mjs`. The component already picks edition behavior at render time (`NEXT_PUBLIC_EDITION`), so the seam carries no behavior. Remove the `LEVERAGE: pattern sso-provider-buttons` marker, because the pattern is resolved.
- FR17: Update the tests that encode the old split: `tools/nx-tests/editionSwapping.test.ts` (same SSO entry path in both editions), `server/src/test/unit/ssoProviderEditionGate.unit.test.tsx` (render the single component under both editions), and delete `packages/auth/src/components/ssoProviderButtons.ceEeParity.test.ts` (there are no longer two copies to compare).

### Non-functional Requirements

- No new unauthenticated endpoint. The offered list is server-rendered into the sign-in page, which is the only thing that reveals it, and that page already shows those buttons to anyone who can load it for that slug or domain.
- The policy read reuses `loadTenantAuthPolicy`'s 15-second per-process cache, so a saved change reaches every replica within about 15 seconds. The saving replica sees it at once.

## Data / API / Integrations

- Storage: `tenant_settings.settings` JSON, `sso.clientPortalSsoProviders`. No migration. Absent means `null`.
- Server actions: `getLoginPolicyAction` / `updateLoginPolicyAction` (EE, `ensureSsoSettingsPermission`). Shape changes as in FR12.
- Routes: `/api/auth/client-portal/sso/discover` and `/resolve` keep their code and contracts. Their results narrow through FR8.
- No change to NextAuth provider registration, `getOAuthSecrets`, OAuth profile mapping, or account linking.

## Security / Permissions

- Writing the list requires the existing SSO settings permission (`ensureSsoSettingsPermission`).
- Enforcement is server-side. A hand-crafted `/resolve` call for a provider outside the list fails, because the signed discovery cookie does not contain it, and the OAuth profile mapping only treats a callback as a client sign-in when a valid client resolution cookie exists.
- No new enumeration surface (see Non-functional). The discover endpoint already returned this tenant's provider list for any slug. It now returns a subset.
- Behavior change to note: a tenant-owned Keycloak realm now counts as available on the client portal (FR7). Today client-portal discovery only counts the app-level Keycloak, while settings (`getSsoProviderOptions`) and the MSP path already count tenant realms. The OAuth path already uses tenant Keycloak credentials for a client resolution. Admins who do not want it can uncheck it.

## Observability

None beyond the existing `LOGIN_POLICY_CHANGED` audit row and a warning log when FR9 fails.

## Rollout / Migration

- No migration, no feature flag. Default (`null`) equals current behavior.
- The de-duplication changes build aliasing. The edition-swap test guards it, and the EE image build must still resolve `@alga-psa/auth/sso/entry`.

## Open Questions

- **MSP sign-in (out of scope):** the MSP page is on a shared domain, and the tenant is unknown until an email is typed (or a `?tenant=` slug scopes the page). Possible later directions:
  - apply a tenant's own "MSP sign-in providers" list once email-domain discovery resolves a tenant (`source: 'tenant'`);
  - honor a list on tenant-scoped MSP sign-in.

  Either would reuse FR5. Before an email is typed, the MSP page has no tenant and cannot be narrowed without revealing tenant configuration.
- Should a later iteration warn admins in the card when an offered provider has neither tenant credentials nor a reachable app? Today it would simply not be listed (FR7).

## Acceptance Criteria (Definition of Done)

1. A tenant with no saved list sees the same client-portal SSO buttons as before this change.
2. After an admin saves `[azure-ad]`, the client portal sign-in page for that tenant (slug or vanity domain) renders only "Sign in with Microsoft" on first paint. Discovery returns only `azure-ad`, and a resolve request for `google` fails generically.
3. After an admin saves `[]`, the client portal shows no SSO buttons and password sign-in still works.
4. The settings card lists only providers available to the tenant, reflects the saved list, saves on toggle, and the save is audited.
5. An update containing an unsupported provider id is rejected with `client_portal_sso_provider_invalid` and nothing is persisted.
6. There is one `SsoProviderButtons` source file. CE and EE builds both resolve `@alga-psa/auth/sso/entry` to it, and the edition gate (CE: Keycloak only on MSP and nothing on the client portal; EE: all three) still holds.
7. New strings exist in every `msp/settings` locale and `node scripts/validate-translations.cjs` passes.
