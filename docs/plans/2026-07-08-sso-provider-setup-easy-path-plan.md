# SSO Provider Setup — Easy Path

**Branch:** `feature/sso-provider-setup-easy-path`
**Date:** 2026-07-08
**Type:** Discoverability / settings-IA consolidation (one new read-only server action; no schema changes)

## Background

There are two doors labeled "SSO", and hosted MSP admins keep walking through the wrong one.

- **The right door — Settings → Security → Single Sign-On** renders `SsoBulkAssignment`
  (`ee/server/src/components/settings/security/SsoBulkAssignment.tsx`, mounted via the
  `single-sign-on` tab in `server/src/components/settings/security/SecuritySettingsPage.tsx`).
  It holds the **auto-link** toggle and the **bulk user → provider assignment** form. Provider
  availability comes from app-level OAuth secrets (`ee/server/src/lib/auth/providerConfig.ts`),
  which on hosted are Nine Minds' own Google/Microsoft OAuth apps — already configured. This
  tab is *all* a hosted tenant needs, but its content reads as "bulk assignment", not "set up SSO".
  On CE the tab shows an enterprise-upgrade stub (`packages/ee/src/components/settings/security/SsoBulkAssignment.tsx`).

- **The wrong door — Settings → General → Providers** stacks `MspSsoLoginDomainsSettings`
  (`packages/integrations/src/components/settings/integrations/MspSsoLoginDomainsSettings.tsx`)
  under the "Google Cloud" integration item in
  `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` (~line 295).
  That panel manages **login-domain claims** (EE: DNS-TXT-verified; CE: advisory) which steer
  MSP login SSO toward **tenant-level** IdP credentials — credentials read via
  `getTenantSecret(tenant, 'google_client_id')` etc. in
  `packages/auth/src/lib/sso/mspSsoResolution.ts`, and **settable by no UI anywhere**. They are
  wired out-of-band on appliance/custom installs only.

**Net effect on hosted:** an admin searching for "SSO" finds "MSP SSO Login Domains", claims
domains, adds DNS records, verifies — and the resolver still falls back to app-level providers
(`resolveMspSsoCredentialSource`), because no tenant credentials exist. A ritual with zero
effect, while the effective path sits one section over with an unhelpful name.

## Goal

One obvious SSO home. Settings → Security → Single Sign-On becomes the single destination:
the easy hosted path front and center, the advanced tenant-credential routing tucked behind a
clearly-labeled collapsed section that *says so* when it is inert. The old location signposts
the move.

## Design decisions (settled in design session)

1. **Move, not signpost-only** — the domain panel relocates to Security → SSO.
2. **Collapsed "Advanced" section** — always present (both editions), collapsed by default,
   with an explicit inert-state notice when no tenant IdP credentials exist. CE keeps its
   advisory-mode panel here (below the upgrade card).
3. **Status header included** — provider-availability chips at the top of the SSO tab (EE),
   so the tab reads as the setup page.
4. **Pointer card at the old location** — slim "this moved" card with a deep link to
   `/msp/security-settings?tab=single-sign-on`; droppable in a later release.

## Implementation

### Change 1 — New server action: tenant IdP credential status

**File:** `packages/integrations/src/actions/integrations/mspSsoDomainActions.ts` (sibling of
the existing `listMspSsoDomainClaims` / `saveMspSsoLoginDomains` actions; export through the
existing barrels `packages/integrations/src/actions/index.ts`).

```ts
export async function getMspSsoTenantCredentialStatus(): Promise<{
  success: boolean;
  google: boolean;
  microsoft: boolean;
}>
```

- Resolve the current tenant the same way the sibling actions do (`createTenantKnex` /
  current-user context) and enforce the same settings permission the sibling actions enforce.
- Call `hasTenantProviderCredentials(tenant, 'google')` and
  `hasTenantProviderCredentials(tenant, 'azure-ad')` from
  `@alga-psa/auth` (`packages/auth/src/lib/sso/mspSsoResolution.ts:235`). Export it from the
  auth package barrel if not already exported.
- Read-only; failures return `{ success: false, google: false, microsoft: false }` and log a
  warning — the UI treats a failure as "unknown" and shows no inert notice rather than a wrong one.

### Change 2 — Advanced section in Security → Single Sign-On

**File:** `server/src/components/settings/security/SecuritySettingsPage.tsx`

The `single-sign-on` tab content becomes a stack:

```tsx
<Suspense fallback={<SsoLoading />}>
  <SsoBulkAssignment />          {/* unchanged EE/CE resolution via @enterprise alias */}
</Suspense>
<MspSsoAdvancedSection />        {/* new, below — both editions */}
```

**New component:** `server/src/components/settings/security/MspSsoAdvancedSection.tsx`
(client component):

- A `Card` whose header is a toggle — title "Advanced: custom identity provider routing",
  chevron, `aria-expanded`, collapsed by default (local `useState`; no persisted state). No
  Collapsible primitive exists in `@alga-psa/ui` — use Card + button header, matching house
  style (cf. `CollapseToggleButton.tsx` for iconography).
- Body (rendered only when expanded, so the panel's data loads lazily):
  1. **Inert-state notice** — on mount of the expanded body, call
     `getMspSsoTenantCredentialStatus()`. When `success && !google && !microsoft`, render an
     info `Alert`: *"No tenant identity provider credentials are configured — domain claims
     currently have no effect. Users sign in with the hosted Google / Microsoft providers.
     Tenant credentials are provisioned on custom and on-premise installations."* When either
     credential exists, or on failure, render nothing extra.
  2. `<MspSsoLoginDomainsSettings />` imported from `@alga-psa/integrations/components`
     (already exported via `packages/integrations/src/components/settings/integrations/index.ts`;
     `server/src` already imports from this entry point in `SettingsPage.tsx`).
- Both editions render this section; `MspSsoLoginDomainsSettings` already branches CE
  (advisory domains) vs EE (claims) internally via `NEXT_PUBLIC_EDITION`.
- i18n namespace: `msp/profile` (the namespace `SecuritySettingsPage` already uses), keys under
  `security.sso.advanced.*`.

### Change 3 — Provider status header in the SSO tab (EE)

**File:** `ee/server/src/components/settings/security/SsoBulkAssignment.tsx`

The component already fetches `getSsoProviderOptionsAction({ scope: "settings" })`. Add a
status strip above the auto-link card:

- One row per option in `providerOptions`: provider name + `Badge` — success "Available" when
  `option.configured`, secondary "Not configured" otherwise.
- Short caption: *"These providers are managed by the platform — no client IDs or DNS setup is
  required. Enable auto-link or assign users below."*
- Renders only when `providerOptions` is non-empty (the existing no-provider fallback stays).
- i18n: `msp/settings` namespace, keys under `ssoBulk.status.*`.
- The CE stub (`packages/ee/src/.../SsoBulkAssignment.tsx`) is unchanged.

### Change 4 — Pointer card at the old location

**File:** `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`

Replace `<MspSsoLoginDomainsSettings />` (~line 295) with a slim inline card:

- Title: "MSP SSO Login Domains" (so admins scanning for the old name find the pointer).
- Body: *"Single sign-on settings, including login-domain claims, have moved to
  Security → Single Sign-On."*
- Button (`id="msp-sso-moved-link"`): "Open Single Sign-On settings" → navigates to
  `/msp/security-settings?tab=single-sign-on` (plain `Link`/router push; the Security page
  already deep-links via its `tab` query param, `SecuritySettingsPage.tsx:102-128`).
- Remove the now-unused `MspSsoLoginDomainsSettings` import here; the component itself stays
  where it lives and stays exported (the Security page now consumes it).
- i18n: `msp/integrations` namespace, keys under `integrations.sso.msp.moved.*`.

### Change 5 — i18n

Add new keys (with `defaultValue`s in code, as house style) to `server/public/locales/en/msp/`:

| Namespace file | Keys |
|---|---|
| `profile.json` | `security.sso.advanced.title`, `.description`, `.inertNotice` |
| `settings.json` | `ssoBulk.status.title`, `.caption`, `.available`, `.notConfigured` |
| `integrations.json` | `integrations.sso.msp.moved.title`, `.body`, `.cta` |

Mirror the keys into the non-English locale dirs (`de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`,
`xx`, `yy`) following the repo's existing translation pattern for sibling keys.

## Tests

1. **`getMspSsoTenantCredentialStatus`** — new unit coverage in
   `packages/integrations/src/actions/integrations/mspSsoDomainActions.test.ts`: permission
   enforcement, both-false / one-true matrices (mock secret provider), failure → safe default.
2. **`MspSsoAdvancedSection`** — new unit test (pattern of
   `server/src/test/unit/components/integrations/MspSsoLoginDomainsSettings.test.tsx`):
   renders collapsed; expanding mounts `MspSsoLoginDomainsSettings`; inert notice shows only
   for `{google:false, microsoft:false, success:true}`.
3. **`SsoBulkAssignment` status header** — extend existing EE component coverage: chips render
   per option with correct configured/not-configured badge; absent when options empty.
4. **`IntegrationsSettingsPage`** — update
   `server/src/test/unit/components/integrations/IntegrationsSettingsPage.*.test.tsx`: the
   Providers stack no longer renders the domain panel; pointer card + deep-link present.
5. **Security page integration** — the `single-sign-on` tab renders both the bulk-assignment
   block and the advanced section (both editions' expectations).

## Manual smoke (dev stack on :3144)

1. Settings → Security → Single Sign-On: status chips (EE), auto-link + bulk assignment,
   collapsed Advanced section at bottom.
2. Expand Advanced: inert notice appears (local stack has no tenant IdP credentials); domain
   panel functions (add claim → DNS challenge shown).
3. Settings → General → Providers: pointer card in place of the old panel; button lands on the
   Security SSO tab.

## Out of scope (explicitly unchanged)

- Any UI for *setting* tenant-level IdP credentials (stays out-of-band for appliances).
- Login-page provider resolution (`mspSsoResolution.ts`, resolve/discover routes) — untouched.
- Removing the pointer card (future release).
- Tier gating changes (`assertTierAccess(TIER_FEATURES.SSO)` stays as-is).
