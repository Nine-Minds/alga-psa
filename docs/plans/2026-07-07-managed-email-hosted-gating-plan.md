# Plan: Gate managed email on hosting, not tier

**Branch:** `fix/license-error-outbound-email`
**Date:** 2026-07-07
**Status:** Approved design, ready for implementation.

## Problem

On the EE on-prem appliance running an `essentials`-tier tenant, visiting the outbound
email settings screen crashes with:

```
Error [TierAccessError]: This feature requires the Solo plan or higher.
  statusCode: 403, code: 'TIER_ACCESS_DENIED',
  feature: 'MANAGED_EMAIL', requiredTier: 'solo', currentTier: 'essentials'
```

### Why it happens

- For EE builds, `server/next.config.mjs` aliases the Email settings entry
  (`@alga-psa/integrations/email/settings/entry`) to the EE component
  `ee/server/src/components/settings/email/ManagedEmailSettings.tsx` (via
  `packages/integrations/src/email/settings/ee/entry.tsx`).
- `ManagedEmailSettings` calls `getManagedEmailDomains()` on mount
  (`useEffect` → `loadDomains`).
- `getManagedEmailDomains` (in
  `ee/server/src/lib/actions/email-actions/managedDomainActions.ts`) begins with
  `await assertTierAccess(TIER_FEATURES.MANAGED_EMAIL)`.
- `FEATURE_MINIMUM_TIER[MANAGED_EMAIL] === 'solo'`, so on an `essentials` tenant
  `assertTierAccess` throws `TierAccessError` (403), which breaks the screen.

### The correct axis: hosted vs self-hosted

Managed email domains rely on Nine Minds' cloud Resend orchestration, which does
not exist on a self-hosted appliance. The gate should therefore be **hosted vs
self-hosted**, not tier. The tier check is **replaced entirely** by a hosting
check:

- **Hosted / SaaS** (no `license_state` row): managed email available to **every**
  tenant, regardless of tier.
- **Self-hosted / appliance** (`license_state` row present): managed email is
  never offered. The outbound screen shows a clean SMTP configuration UI with no
  upsell.

### Existing primitive to reuse

`isSelfHostLicensing()` from `@alga-psa/licensing`
(`packages/licensing/src/lib/license-state.ts`) already returns `true` on
self-host (a `license_state` row exists) and `false` on hosted/SaaS.
`server/src/app/msp/layout.tsx` already resolves it server-side and passes
`selfHostLicensing` into `MspLayoutClient`, which wraps the app in `TierProvider`.

## Design decisions (settled)

1. Basic outbound email (SMTP / from-address) is a floor capability and must keep
   working on `essentials`; only the managed-domains machinery is gated.
2. The gate is hosting, not tier — hosting **replaces** the tier check entirely.
3. On hosted installs managed email is available to all tiers.
4. On self-host the outbound screen shows plain SMTP config with **no lock/upsell
   notice**; the resend-provider option and managed-domains card do not render.

## Changes

The work spans four layers. Server-side hosting guard is the backstop that
guarantees no crash even if the client gating is ever mis-wired.

### 1. Hosting guard in `@alga-psa/licensing`

**File:** `packages/licensing/src/lib/license-state.ts` (and package barrel
export, e.g. `packages/licensing/src/index.ts`).

- Add a `HostingRequiredError` class:
  - `statusCode = 403`, `code = 'HOSTING_REQUIRED'`, `name = 'HostingRequiredError'`.
  - Message along the lines of "Managed email is only available on hosted
    installs." Keep it feature-agnostic or accept an optional feature label so the
    class is reusable for future hosted-only features.
- Add `async function assertHostedInstall(): Promise<void>` that throws
  `HostingRequiredError` when `await isSelfHostLicensing()` is `true`; returns
  normally on hosted/SaaS.
- Export both from the package entry point so EE actions can import them.

### 2. Managed-domain server actions

**File:** `ee/server/src/lib/actions/email-actions/managedDomainActions.ts`.

- Remove the `assertTierAccess` import; import `assertHostedInstall` /
  `HostingRequiredError` from `@alga-psa/licensing`.
- `getManagedEmailDomains` (read): replace
  `await assertTierAccess(TIER_FEATURES.MANAGED_EMAIL)` with an early
  self-host check that **returns `[]`** when `isSelfHostLicensing()` is true
  (graceful, non-throwing — prevents the screen from crashing regardless of the
  client flag). On hosted, proceed as today.
- `requestManagedEmailDomain`, `refreshManagedEmailDomain`,
  `deleteManagedEmailDomain` (mutations): replace
  `await assertTierAccess(TIER_FEATURES.MANAGED_EMAIL)` with
  `await assertHostedInstall()` so they throw `HostingRequiredError` on
  self-host. These are never reachable from a correctly-gated self-host UI; the
  guard is defense-in-depth.

### 3. Expose `isHosted` on `TierContext`

**Files:** `server/src/context/TierContext.tsx`,
`server/src/app/msp/MspLayoutClient.tsx`.

- `TierProvider` accepts a new prop, e.g. `selfHostLicensing?: boolean`
  (default `false`).
- Add `isHosted: boolean` to `TierContextValue`, computed as
  `!selfHostLicensing`. Default when the prop is absent = hosted (`true`), so
  hosted paths never accidentally hide the feature. Self-host is protected by the
  server guard in §2 regardless.
- `MspLayoutClient` passes its existing `selfHostLicensing` prop into
  `<TierProvider selfHostLicensing={selfHostLicensing}>`.
- Audit other `TierProvider` mount points (e.g. any non-MSP layouts). The
  managed-email surface only renders under the MSP layout, which supplies the
  prop; other mounts fall back to the hosted default, which is safe given the
  server backstop. Document any mount point that would need the prop if a
  hosted-only surface is added there later.

### 4. `ManagedEmailSettings.tsx`

**File:** `ee/server/src/components/settings/email/ManagedEmailSettings.tsx`.

- Replace `const canUseManagedEmail = hasFeature(TIER_FEATURES.MANAGED_EMAIL)`
  with `const { isHosted } = useTier();` and use `isHosted` as the gate (rename
  the local to `canUseManagedEmail = isHosted` or use `isHosted` directly — keep
  the existing branch names to minimize churn).
- Guard the domains load: only call `loadDomains()` when `isHosted`; when not
  hosted, skip the fetch and leave `domains` empty with `loadingDomains = false`.
- Outbound provider defaulting (`loadOutboundState`): keep forcing `smtp` when not
  hosted.
- Provider card: replace the current `!canUseManagedEmail` branch (the `Lock`
  icon + `managed.outbound.upgradeNotice` "upgrade to unlock" block) with a plain
  SMTP presentation — no lock, no upsell. On self-host there is nothing to
  upgrade to. Options:
  - render just the SMTP config card (drop the provider-select entirely since
    SMTP is the only option), or
  - show a simple non-locked SMTP label.
  Remove the now-unused `Lock` import if nothing else uses it.
- The managed-domains card (`outboundProvider === 'resend' && canUseManagedEmail`)
  and resend-provider option already collapse to hidden when `isHosted` is false —
  verify they do not render on self-host.
- Remove the now-unused `TIER_FEATURES` import if it is no longer referenced.

### 5. Remove `MANAGED_EMAIL` from the tier taxonomy

Managed email is no longer tier-gated, so it should not appear in the
tier-feature taxonomy or the hosted plan-comparison matrix.

**Files:**

- `packages/types/src/constants/tierFeatures.ts`: remove the
  `MANAGED_EMAIL = 'MANAGED_EMAIL'` enum member and its `FEATURE_MINIMUM_TIER`
  entry. `TIER_FEATURE_MAP` is derived and needs no manual edit once the enum
  member is gone.
- `packages/types/src/constants/tierFeatures.test.ts`: remove the
  `MANAGED_EMAIL` assertions (enum value, feature lists, `tierHasFeature`,
  `FEATURE_MINIMUM_TIER`).
- `ee/server/src/components/settings/account/AccountManagement.tsx`: remove the
  `[TIER_FEATURES.MANAGED_EMAIL]: 'features.managedEmail'` entry from
  `FEATURE_TRANSLATION_KEYS` (the `Record<TIER_FEATURES, string>` becomes exact
  again once the enum member is removed).
- `server/src/lib/tier-gating/assertTierAccess.ts`: the docblock `@example` uses
  `TIER_FEATURES.MANAGED_EMAIL`; switch the example to another feature (e.g.
  `SSO`).
- Grep for any remaining non-test references to `MANAGED_EMAIL` /
  `managedEmail` feature keys and clean up (leave the i18n string
  `features.managedEmail` only if still referenced; otherwise remove).

## Verification

- `essentials` self-host appliance: `/msp/settings?tab=email` loads without a
  `TierAccessError`; outbound tab shows SMTP config, no lock/upgrade notice, no
  managed-domains card; server log no longer emits the `TIER_ACCESS_DENIED`
  `MANAGED_EMAIL` error.
- Confirm SMTP save (`updateEmailSettings`) and `testOutboundEmail` work on
  self-host (both are tier-agnostic CE actions).
- Hosted/SaaS: managed email UI (resend provider option + domains card) still
  renders; add/refresh/delete domain still function; verify a hosted `essentials`
  tenant now sees managed email (tier no longer gates it).
- Typecheck `packages/types`, `server`, and `ee/server` after the taxonomy
  removal so no exhaustiveness or import errors remain.
- Run `packages/types/src/constants/tierFeatures.test.ts`.

## Out of scope

- No changes to the OSS `EmailSettings` component
  (`packages/integrations/src/components/email/admin/EmailSettings.tsx`); self-host
  EE continues to render the EE `ManagedEmailSettings`, now correctly gated.
- No changes to inbound email provider configuration.
- No new session/JWT fields; hosting is threaded via the already-resolved
  `selfHostLicensing` layout prop.
