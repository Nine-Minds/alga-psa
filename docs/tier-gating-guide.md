# Tier Gating Developer Guide

How to add a new feature to the tier gate system.

## Architecture Overview

The tier system has three active tiers: **Essentials**, **Solo**, and **Pro**. Pro is the only paid tier above Solo. The `tenants.plan` column is the single source of truth. Features are gated at three layers:

1. **UI** — hide/show with `TierGate` (client) or `ServerTierGate` (server component)
2. **Navigation** — filter sidebar items
3. **Server actions** — enforce with `assertTierAccess()`

In Community Edition (CE), all features are unlocked regardless of tier.

## Step-by-Step: Adding a New Gated Feature

### 1. Add to TIER_FEATURES enum

```ts
// packages/types/src/constants/tierFeatures.ts
export enum TIER_FEATURES {
  ENTRA_SYNC = 'ENTRA_SYNC',
  CIPP = 'CIPP',
  YOUR_NEW_FEATURE = 'YOUR_NEW_FEATURE',  // ← add here
}
```

### 2. Add to FEATURE_MINIMUM_TIER

Declare the lowest tier that receives the feature. Use Pro for paid features:

```ts
// packages/types/src/constants/tierFeatures.ts
export const FEATURE_MINIMUM_TIER: Record<TIER_FEATURES, TenantTier> = {
  [TIER_FEATURES.ENTRA_SYNC]: 'pro',
  [TIER_FEATURES.CIPP]: 'pro',
  [TIER_FEATURES.YOUR_NEW_FEATURE]: 'pro',  // ← add here
};
```

### 3. Verify the derived TIER_FEATURE_MAP

```ts
// packages/types/src/constants/tierFeatures.ts
expect(TIER_FEATURE_MAP.pro).toContain(TIER_FEATURES.YOUR_NEW_FEATURE);
```

`TIER_FEATURE_MAP` is derived from the minimum-tier map and tier ranks; do not maintain a second hand-written entitlement list.

### 4. Gate UI components

**Client-side (in a client component):**

```tsx
import { TierGate } from '@/components/tier-gating/TierGate';
import { TIER_FEATURES } from '@alga-psa/types';

// Wraps children — shows FeatureUpgradeNotice if tier lacks access
<TierGate feature={TIER_FEATURES.YOUR_NEW_FEATURE} featureName="Your Feature">
  <YourFeatureComponent />
</TierGate>
```

**Or use the hook directly:**

```tsx
import { useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

const canUseFeature = useTierFeature(TIER_FEATURES.YOUR_NEW_FEATURE);
// canUseFeature is boolean — true if tier has access OR if CE edition
```

**Server component:**

```tsx
import { ServerTierGate } from '@/lib/tier-gating/ServerTierGate';
import { TIER_FEATURES } from '@alga-psa/types';

// Async server component — reads session directly
<ServerTierGate feature={TIER_FEATURES.YOUR_NEW_FEATURE} featureName="Your Feature">
  <YourFeatureComponent />
</ServerTierGate>
```

### 5. Gate server actions

```ts
import { assertTierAccess, TierAccessError } from '@/lib/tier-gating/assertTierAccess';
import { TIER_FEATURES } from '@alga-psa/types';

export async function yourProtectedAction() {
  // Throws TierAccessError if tenant lacks access
  // CE edition: always passes
  await assertTierAccess(TIER_FEATURES.YOUR_NEW_FEATURE);

  // ... your action logic
}
```

#### Background runtimes have no session

`assertTierAccess` reads the session, so it is unusable from the Temporal worker,
job runners, and scripts. Those resolve the tenant's tier directly:

```ts
import { resolveTenantTier } from '@alga-psa/licensing';
import { TIER_FEATURES, tierHasFeature } from '@alga-psa/types';

const allowed = tierHasFeature(await resolveTenantTier(tenantId), TIER_FEATURES.YOUR_NEW_FEATURE);
```

If a feature has a recurring background component, gate it on the same feature
the request path gates on. `setupSchedules.ts` gated Entra's recurring sync on
the Enterprise add-on long after the UI and API moved to Pro, so Pro tenants got
the whole UI while the worker deleted their schedule on every boot.

### 6. Add display name in AccountManagement

```ts
// ee/server/src/components/settings/account/AccountManagement.tsx
const FEATURE_DISPLAY_NAMES: Record<TIER_FEATURES, string> = {
  [TIER_FEATURES.ENTRA_SYNC]: 'Microsoft Entra Sync — ...',
  [TIER_FEATURES.CIPP]: 'CIPP Integration — ...',
  [TIER_FEATURES.YOUR_NEW_FEATURE]: 'Your Feature — description here',  // ← add
};
```

### 7. Write tests

**Unit test for feature mapping:**

```ts
// packages/types/src/constants/tierFeatures.test.ts
it('pro tier has YOUR_NEW_FEATURE', () => {
  expect(tierHasFeature('pro', TIER_FEATURES.YOUR_NEW_FEATURE)).toBe(true);
});

it('solo tier does not have YOUR_NEW_FEATURE', () => {
  expect(tierHasFeature('solo', TIER_FEATURES.YOUR_NEW_FEATURE)).toBe(false);
});
```

**Unit test for server action gating:**

```ts
// your-feature.test.ts
it('throws TierAccessError for solo tenant', async () => {
  mockGetSession.mockResolvedValue({ user: { plan: 'solo' } });
  await expect(assertTierAccess(TIER_FEATURES.YOUR_NEW_FEATURE))
    .rejects.toThrow(TierAccessError);
});
```

## CE Bypass Behavior

In Community Edition (`NEXT_PUBLIC_EDITION !== 'enterprise'`):
- `TierContext.hasFeature()` always returns `true`
- `ServerTierGate` renders children unconditionally
- `assertTierAccess()` returns without checking

This means CE users get all features regardless of `tenants.plan`.

## Key Files

| File | Purpose |
|------|---------|
| `packages/types/src/constants/tierFeatures.ts` | Feature enum, tier-to-feature mapping |
| `packages/types/src/constants/tenantTiers.ts` | Tier types, resolveTier() |
| `server/src/context/TierContext.tsx` | Client-side tier context + hooks |
| `server/src/components/tier-gating/TierGate.tsx` | Client-side gate component |
| `server/src/lib/tier-gating/ServerTierGate.tsx` | Server-side gate component |
| `server/src/lib/tier-gating/assertTierAccess.ts` | Server action enforcement |
| `packages/licensing/src/lib/tenant-tier.ts` | Session-free tier resolution (shared by actions and background runtimes) |
| `ee/temporal-workflows/src/schedules/setupSchedules.ts` | Per-tenant recurring schedules; gates on tier, not add-ons |
| `packages/ui/src/components/tier-gating/FeatureUpgradeNotice.tsx` | Upgrade CTA shown when gated |
| `ee/server/src/components/settings/account/AccountManagement.tsx` | Account page feature display |

## Existing Gated Features (for reference)

| Feature | Enum | Minimum tier | Gated Where |
|---------|------|--------------|-------------|
| Entra Sync | `ENTRA_SYNC` | Pro | IntegrationsSettingsPage, SettingsPage, Entra API routes |
| CIPP | `CIPP` | Pro | EntraIntegrationSettings connection options |
| Advanced Authorization Bundles | `ADVANCED_AUTHORIZATION_BUNDLES` | Pro | PolicyManagement and authorization bundle actions |
| Opportunity Management | `OPPORTUNITY_MANAGEMENT` | Pro | Opportunity routes and actions |

## Dormant Enterprise Add-on Plumbing

`ADD_ONS.ENTERPRISE`, `assertAddOnAccess`, and the Enterprise Stripe price configuration are retained intentionally for a future per-client-tenant metered product. Entra Sync and CIPP no longer depend on this add-on; do not remove the dormant plumbing as dead code. The product strategy is recorded in `nineminds-vault/Inbox/2026-07-22-m365-per-tenant-metering-strategy.md`.
