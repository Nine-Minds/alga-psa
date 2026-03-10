import { describe, expect, it } from 'vitest';
import {
  TENANT_TIERS,
  type TenantTier,
  TIER_LABELS,
  isValidTier,
  resolveTier,
  TIER_FEATURES,
  type TierFeature,
  TIER_FEATURE_MAP,
  tierHasFeature,
  FEATURE_MINIMUM_TIER,
  ADD_ONS,
  type AddOnKey,
  tenantHasAddOn,
} from '@alga-psa/types';

describe('tier exports from @alga-psa/types', () => {
  it('tier types and functions are exported', () => {
    expect(TENANT_TIERS).toBeDefined();
    expect(TIER_LABELS).toBeDefined();
    expect(typeof isValidTier).toBe('function');
    expect(typeof resolveTier).toBe('function');
    expect(TIER_FEATURES).toBeDefined();
    expect(TIER_FEATURE_MAP).toBeDefined();
    expect(typeof tierHasFeature).toBe('function');
    expect(FEATURE_MINIMUM_TIER).toBeDefined();

    const tier: TenantTier = 'pro';
    expect(tier).toBe('pro');

    const feature: TierFeature = TIER_FEATURES.ENTRA_SYNC;
    expect(feature).toBe('ENTRA_SYNC');
  });

  it('add-on types and functions are exported', () => {
    expect(ADD_ONS).toBeDefined();
    expect(typeof tenantHasAddOn).toBe('function');
  });
});
