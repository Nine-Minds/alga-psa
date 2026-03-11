# Tier Gating Developer Guide

How to add a new feature to the tier gate system.

## Architecture Overview

The tier system has two tiers: **Pro** and **Premium**. The `tenants.plan` column is the single source of truth. Features are gated at three layers:

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

### 2. Add to TIER_FEATURE_MAP

Map which tiers get the feature:

```ts
// packages/types/src/constants/tierFeatures.ts
export const TIER_FEATURE_MAP: Record<TenantTier, TIER_FEATURES[]> = {
  pro: [],
  premium: [
    TIER_FEATURES.ENTRA_SYNC,
    TIER_FEATURES.CIPP,
    TIER_FEATURES.YOUR_NEW_FEATURE,  // ← add here
  ],
};
```

### 3. Add to FEATURE_MINIMUM_TIER

```ts
// packages/types/src/constants/tierFeatures.ts
export const FEATURE_MINIMUM_TIER: Record<TIER_FEATURES, TenantTier> = {
  [TIER_FEATURES.ENTRA_SYNC]: 'premium',
  [TIER_FEATURES.CIPP]: 'premium',
  [TIER_FEATURES.YOUR_NEW_FEATURE]: 'premium',  // ← add here
};
```

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
it('premium tier has YOUR_NEW_FEATURE', () => {
  expect(tierHasFeature('premium', TIER_FEATURES.YOUR_NEW_FEATURE)).toBe(true);
});

it('pro tier does not have YOUR_NEW_FEATURE', () => {
  expect(tierHasFeature('pro', TIER_FEATURES.YOUR_NEW_FEATURE)).toBe(false);
});
```

**Unit test for server action gating:**

```ts
// your-feature.test.ts
it('throws TierAccessError for pro tenant', async () => {
  mockGetSession.mockResolvedValue({ user: { plan: 'pro' } });
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
| `packages/ui/src/components/tier-gating/FeatureUpgradeNotice.tsx` | Upgrade CTA shown when gated |
| `ee/server/src/components/settings/account/AccountManagement.tsx` | Account page feature display |

## Existing Gated Features (for reference)

| Feature | Enum | Gated Where |
|---------|------|-------------|
| Visual Invoice Designer | `INVOICE_DESIGNER` | InvoiceTemplateEditor visual tab, BillingPageClient |
| Entra Sync | `ENTRA_SYNC` | IntegrationsSettingsPage, SettingsPage |
| CIPP | `CIPP` | EntraIntegrationSettings connection options |
