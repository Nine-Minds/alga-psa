# Scratchpad — Client portal sign-in: show only the SSO providers the tenant offers

- Plan slug: `client-portal-tenant-sso-provider-visibility`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989
- Code verified against origin/main at `88c634d5b5`.

## Decisions

- (2026-11-10) **What "the tenant offers provider X" means:** an explicit tenant choice, one list `settings.sso.clientPortalSsoProviders`. It is intersected with "can sign in for this tenant", meaning tenant credentials OR app fallback credentials. `null`/absent means every available provider, which is today's behavior.
  - Rejected "tenant has its own credentials for X": client-portal OAuth matches the IdP email to a client user in the tenant from the signed resolution cookie and never needs tenant credentials. Hosted tenants offer client SSO through the platform app, so that rule would silently remove SSO from them.
  - Rejected "app credentials exist": that is today's rule and the bug.
  - The intent cannot be derived from config, so it must be stated.
- (2026-11-10) **One list, not per-provider flags.** It lives in the existing login policy (`TenantAuthPolicy`, `settings.sso`) and the existing Sign-in policy card. The card already holds a client-user policy (2FA for client portal), and the policy already has normalize/guard/audit/cache plumbing. No new card, tab or disconnected setting.
- (2026-11-10) **No new pre-auth endpoint.** The sign-in page is a server component that already resolves the tenant (slug, or `getTenantSlugByDomain`). It computes the offered list server-side and passes it down as a prop. The only exposure is the buttons themselves, which the page already shows. The discover route stays as is but narrows through `discoverClientPortalSsoProviders`. Because `/resolve` requires the provider to be in the signed discovery cookie, the setting is enforced and not only cosmetic.
- (2026-11-10) **Fail open to password, closed to SSO.** If the page-side lookup fails, it renders no SSO buttons. The password form always works. Discovery already returns a neutral `providers: []` on error.
- (2026-11-10) **Collapse the two SsoProviderButtons copies in this PR**, by deleting the EE copy and pointing `@alga-psa/auth/sso/entry` at the shared file in both editions. Re-exporting was rejected:
  - The EE copy cannot import `@alga-psa/auth/sso/entry`, because the EE build rewrites that specifier back to the EE file (a cycle). It would need a relative path into `packages/`.
  - The seam no longer carries behavior. Edition is decided at render time from `NEXT_PUBLIC_EDITION` (`visibleProviders`), and the discovery and resolver endpoints enforce the same split.
  - Keeping the seam would mean every change, including this one, is made twice.
- (2026-11-10) **Tenant Keycloak counts as available on the client portal.**
  - `discoverClientPortalSsoProviders` today only checks app-level Keycloak. `getSsoProviderOptions` (settings) and MSP discovery both count a tenant realm, and `getOAuthSecrets` already swaps in tenant Keycloak credentials for a client-portal resolution.
  - The new settings list must agree with what sign-in offers, so one availability function (`listClientPortalAvailableSsoProviders`) feeds both the page/discovery and the settings checkboxes.
  - The history (#2479 then #3347) shows Keycloak was added to client-portal discovery as app-only without stated rationale.
- (2026-11-10) `saveTenantAuthPolicy` writes the whole normalized policy object instead of enumerating fields. Each policy field is currently enumerated in normalize, apply and save. Adding a field to the save list would be the fourth copy, and the fix is trivial.

## Discoveries / Constraints

Component and wiring:
- (2026-11-10) The two copies of `SsoProviderButtons.tsx` differ only in two comment blocks (`diff` confirmed): `packages/auth/src/components/SsoProviderButtons.tsx` and `ee/server/src/components/auth/SsoProviderButtons.tsx`. The shared copy already carries `// LEVERAGE: pattern sso-provider-buttons`.
- (2026-11-10) Edition seam wiring:
  - `server/next.config.mjs`: alias at ~250 and ~753 (`isEE ? ee copy : shared`), plus a webpack resolve-plugin rewrite at ~1129/~1182 (`authSsoButtonsEeEntry`).
  - `ee/server/next.config.mjs`: ~55 and ~141.
  - tsconfig `paths` and the `packages/auth/package.json` `./sso/entry` export already point at the shared file.
  - Tests that encode the split: `tools/nx-tests/editionSwapping.test.ts` (`ssoEntry`), `server/src/test/unit/ssoProviderEditionGate.unit.test.tsx` (imports the EE copy), and `packages/auth/src/components/ssoProviderButtons.ceEeParity.test.ts`.
- (2026-11-10) `visibleProviders` (~line 53) is the edition filter. CE shows Keycloak only on MSP and nothing on the client portal. EE shows google, azure-ad and keycloak. Note that Keycloak is a third provider, not only Google/Microsoft.
- (2026-11-10) Visible set today is the edition set ∩ (NextAuth registry `/api/auth/providers` ∪ discovery result). Until the registry answers, all edition providers render disabled. Discovery only toggles enabled state, plus tenant-only providers that discovery names.
- (2026-11-10) `ClientLoginForm.tsx` renders the buttons only when `tenantSlug || portalDomain` (lines ~270-278). `MspLoginForm.tsx` ~319 renders them unconditionally, passing `tenantHint={tenantSlug}`. Both confirmed.

Discovery and providers:
- (2026-11-10) Client-portal discovery (`server/src/app/api/auth/client-portal/sso/discover/route.ts`) is already **tenant-scoped, not email-scoped**. The email is only validated and used as the rate-limit bucket. The provider list comes from `discoverClientPortalSsoProviders(tenantId)`, which applies tenant-or-app per Google/Microsoft and app-only for Keycloak, returning `[]` on CE.
- (2026-11-10) `resolveClientPortalSsoTenantContext` accepts slug, portal domain (`portal_domains` with `status='active'`), or a callback URL. It requires them to agree and otherwise returns `{}`.
- (2026-11-10) The resolve route rejects a provider that is not in the signed `client_portal_sso_discovery` cookie, and it re-checks that the tenant context matches the cookie's tenant.
- (2026-11-10) NextAuth providers are built from app secrets/env in `getOAuthSecrets` (~1455-1580). `buildAuthOptions` registers them at ~1594-1601. A valid client-portal resolution cookie swaps in that tenant's own credentials for the resolved provider.
- (2026-11-10) `discoverMspSsoProviderOptions` and `hasTenantProviderCredentials` are at `mspSsoResolution.ts` ~417-466 and ~313 (`hasAppFallbackProviderCredentials` ~334). Confirmed.

How client users authenticate:
- (2026-11-10) `getSsoProfileHints` reads the signed client resolution cookie and returns `{ userType: 'client', tenantHint: tenantId }`. The EE `mapOAuthProfileToExtendedUser` (`ee/server/src/lib/auth/ssoProviders.ts`) then finds an **active `user_type='client'` user by email in that tenant** and fails on tenant mismatch.
- (2026-11-10) Account linking (`ensureOAuthAccountLink`) is optional. It links on an explicit link nonce, an existing link, or `autoLinkClient`, and otherwise skips linking **and still signs in**.
- (2026-11-10) So any IdP account presenting the client user's email works, through the platform app or tenant credentials. Users who type a personal Google account get `no_matching_user`. That is the support pain here.

Login policy:
- (2026-11-10) The login policy from #3795 lives in `tenant_settings.settings.sso`, next to `autoLinkInternal`/`autoLinkClient`, which `ssoPreferences.ts` writes. `loadTenantAuthPolicy` is server-only, reads through the admin connection, has a 15 s per-process cache, and is invalidated on save.
- (2026-11-10) `saveTenantAuthPolicy` spreads the existing `sso` blob, so other keys survive, and writes `LOGIN_POLICY_CHANGED` with the full before/after policy in the same transaction.
- (2026-11-10) `authPolicy.ts` is declared PURE (no I/O), so it cannot import `mspSsoResolution.ts` (secrets/db). That is why the provider id list moves to the pure `lib/sso/types.ts`.
- (2026-11-10) The CE stub `packages/ee/src/lib/actions/auth/loginPolicy.ts` hand-copies the `LoginPolicyState` types. It must be updated alongside EE.
- (2026-11-10) Provider name strings exist at `ssoBulk.form.providerNames.{google,microsoft}` (no Keycloak). `providerConfig.ts` names are hard-coded English. The new UI uses its own `loginPolicy.clientPortalSso.providers.*` keys.

Prior work:
- (2026-11-10) The prior design `docs/plans/2026-05-09-client-portal-sso-entra-entitlement-design.md` already says client-portal SSO must be tenant-scoped, and that "Provider not configured: provider is not returned by discovery". This plan extends "configured" to "offered by the tenant".

## Commands / Runbooks

- Unit: `cd packages/auth && npx vitest run src/lib/authPolicy.test.ts src/lib/sso/clientPortalSsoResolution.test.ts`
- Server unit: `cd server && npx vitest run src/test/unit/ssoProviderEditionGate.unit.test.tsx src/test/unit/settings/`
- Integration (needs test DB): `cd server && npx vitest run src/test/integration/loginPolicyAuditAndRevocation.integration.test.ts` (extend it or add a sibling file)
- Edition seam: `npx vitest run tools/nx-tests/editionSwapping.test.ts`
- Translations: `node scripts/validate-translations.cjs`
- Find leftover seam references: `git grep -n "components/auth/SsoProviderButtons\|authSsoButtonsEeEntry"`

## Links / References

- Component: `packages/auth/src/components/SsoProviderButtons.tsx`, `ClientLoginForm.tsx`, `ClientPortalSignIn.tsx`, `MspLoginForm.tsx`
- Page: `server/src/app/auth/client-portal/signin/page.tsx`
- Discovery: `packages/auth/src/lib/sso/clientPortalSsoResolution.ts`, `packages/auth/src/lib/sso/mspSsoResolution.ts`
- Routes: `server/src/app/api/auth/client-portal/sso/{discover,resolve}/route.ts`
- Policy: `packages/auth/src/lib/authPolicy.ts`, `packages/auth/src/lib/authPolicyStore.ts`, `ee/server/src/lib/actions/auth/loginPolicy.ts`, `ee/server/src/components/settings/security/LoginPolicySettings.tsx`, CE stubs under `packages/ee/src/...`
- Settings host: `server/src/components/settings/security/SecuritySettingsPage.tsx` (Single Sign-On tab)
- OAuth mapping: `packages/auth/src/lib/nextAuthOptions.ts` (`getSsoProfileHints`, `getOAuthSecrets`, `ensureOAuthAccountLink`), `ee/server/src/lib/auth/ssoProviders.ts`
- Locales: `server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv,xx,yy}/msp/settings.json`
- Prior plans: `ee/docs/plans/2026-05-09-client-portal-sso-entra-entitlement/`, PR #3795 (login policy), PR #3347 (Keycloak first-class)

## Open Questions

- MSP sign-in provider narrowing (out of scope). See PRD Open Questions.

## Implementation log (draft implementation, 2026-11-10)

- (2026-11-10) **Guard input.** `applyPolicyChange` canonicalizes the requested list (drops unknown ids), so the guard could never see a bad id in `next`. `validatePolicyChange` therefore takes an optional `requestedClientPortalSsoProviders` (the raw list from the update), and `updateLoginPolicyAction` passes `updates.clientPortalSsoProviders` through. The check also runs on the Require-SSO OFF transition, which otherwise skips guard errors.
- (2026-11-10) `SsoProviderId`/`SSO_PROVIDER_IDS`/`isSupportedProvider` now live in `lib/sso/types.ts`. `mspSsoResolution.ts` re-exports `isSupportedProvider` and `SsoProviderId`, and `MspSsoProviderId` is an alias of `SsoProviderId`.
- (2026-11-10) `saveTenantAuthPolicy` now spreads `...after` into `settings.sso` (after the existing `sso` blob), so other `sso` keys such as `autoLinkClient` survive and new policy fields need no extra edit.
- (2026-11-10) **Deviation (minor):** `ee/server/next.config.mjs` keeps its two `@alga-psa/auth/sso/entry` aliases but they now point at `packages/auth/src/components/SsoProviderButtons.tsx`, instead of being deleted. The `authSsoButtonsEeEntry` rewrite in `server/next.config.mjs` was removed outright; tsconfig `paths` and the package `exports` map already resolve to the shared file.
- (2026-11-10) **Deviation (minor):** two historical plan docs (`docs/plans/2026-10-27-cm-t0-5b-plan.md`, `ee/docs/plans/2026-02-23-msp-tenant-first-sso-provider-resolution/SCRATCHPAD.md`) named the deleted EE file path. They were reworded so that `git grep "components/auth/SsoProviderButtons"` returns nothing, as the work order requires.
- (2026-11-10) **Test invocation gotchas.**
  - `npx vitest run tools/nx-tests/...` from the repo root picks up the wrong config. Use `npx vitest run --config tools/nx-tests/vitest.config.ts tools/nx-tests/editionSwapping.test.ts`.
  - `packages/auth/vitest.config.ts` only includes `src/**/*.test.ts`. The `.tsx` component tests under `packages/auth/src/components/` run through the server config (`cd server && npx vitest run ../packages/auth/src/components/...`).
  - Whole-project `tsc --noEmit` in `server` aborts with out-of-memory even at 12 GB. Typecheck was done with a temporary `tsconfig` that `extends` the project one and lists the touched files under `files`.
  - In the server tsconfig, `@ee/*` maps to the CE stubs, so `ee/server/src/lib/actions/auth/loginPolicy.ts` reports `Cannot find module '@ee/lib/actions/auth/ssoPermissions'` there. That is not from this change; the same file typechecks cleanly with the `ee/server` tsconfig.
- (2026-11-10) Locale files were edited as text insertions (not JSON re-serialization): e.g. `de/msp/settings.json` has irregular indentation that a JSON dump would reformat. `xx`/`yy` come from `node scripts/generate-pseudo-locales.cjs`.
- (2026-11-10) Not exercised: a real EE webpack build resolving `@alga-psa/auth/sso/entry`, and the server action `updateLoginPolicyAction` end to end (T003 covers the pure guard plus the store against the real DB; the EE action itself needs the permission/session machinery).
