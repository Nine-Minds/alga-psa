import { describe, expect, it, vi, beforeEach } from 'vitest';
import { assertTierAccess, TierAccessError } from './assertTierAccess';
import { TIER_FEATURES } from '@alga-psa/types';

// Mock the auth module
vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(),
}));

// Mock as EE so tier checks are enforced
vi.mock('@/lib/features', () => ({
  isEnterprise: true,
}));

import { getSession } from '@alga-psa/auth';

describe('assertTierAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('TierAccessError', () => {
    it('creates error with correct properties', () => {
      const error = new TierAccessError(TIER_FEATURES.ENTRA_SYNC, 'premium', 'pro');
      expect(error.name).toBe('TierAccessError');
      expect(error.feature).toBe(TIER_FEATURES.ENTRA_SYNC);
      expect(error.requiredTier).toBe('premium');
      expect(error.currentTier).toBe('pro');
      expect(error.message).toContain('Premium');
    });
  });

  describe('assertTierAccess function', () => {
    it('throws TierAccessError for pro tenant accessing ENTRA_SYNC', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).rejects.toMatchObject({
        feature: TIER_FEATURES.ENTRA_SYNC,
        requiredTier: 'premium',
        currentTier: 'pro',
      });
    });

    it('does not throw for premium tenant accessing ENTRA_SYNC', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'premium' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).resolves.toBeUndefined();
    });

    it('throws TierAccessError for solo tenant accessing INTEGRATIONS', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INTEGRATIONS)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.INTEGRATIONS)).rejects.toMatchObject({
        feature: TIER_FEATURES.INTEGRATIONS,
        requiredTier: 'pro',
        currentTier: 'solo',
      });
    });

    it('does not throw for pro tenant accessing INTEGRATIONS', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INTEGRATIONS)).resolves.toBeUndefined();
    });

    it('throws TierAccessError for solo tenant accessing EXTENSIONS', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.EXTENSIONS)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.EXTENSIONS)).rejects.toMatchObject({
        feature: TIER_FEATURES.EXTENSIONS,
        requiredTier: 'pro',
        currentTier: 'solo',
      });
    });

    it('throws for NULL plan tenant (misconfigured → pro)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: null },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).rejects.toMatchObject({
        currentTier: 'pro',
      });
    });
  });
});
