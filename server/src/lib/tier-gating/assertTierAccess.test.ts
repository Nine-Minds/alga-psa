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
      const error = new TierAccessError(TIER_FEATURES.INVOICE_DESIGNER, 'premium', 'pro');
      expect(error.name).toBe('TierAccessError');
      expect(error.feature).toBe(TIER_FEATURES.INVOICE_DESIGNER);
      expect(error.requiredTier).toBe('premium');
      expect(error.currentTier).toBe('pro');
      expect(error.message).toContain('Premium');
    });
  });

  describe('assertTierAccess function', () => {
    it('throws TierAccessError for pro tenant accessing INVOICE_DESIGNER', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)).rejects.toMatchObject({
        feature: TIER_FEATURES.INVOICE_DESIGNER,
        requiredTier: 'premium',
        currentTier: 'pro',
      });
    });

    it('does not throw for premium tenant accessing INVOICE_DESIGNER', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'premium' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)).resolves.toBeUndefined();
    });

    it('throws for NULL plan tenant (misconfigured → pro, but still no INVOICE_DESIGNER)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: null },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.INVOICE_DESIGNER)).rejects.toMatchObject({
        currentTier: 'pro',
      });
    });
  });
});
