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

    it('does not throw for solo tenant accessing INTEGRATIONS (now unlocked at solo)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INTEGRATIONS)).resolves.toBeUndefined();
    });

    it('does not throw for pro tenant accessing INTEGRATIONS', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.INTEGRATIONS)).resolves.toBeUndefined();
    });

    it('does not throw for solo tenant accessing EXTENSIONS (now unlocked at solo)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.EXTENSIONS)).resolves.toBeUndefined();
    });

    it('throws TierAccessError for solo tenant accessing WORKFLOW_DESIGNER', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.WORKFLOW_DESIGNER)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.WORKFLOW_DESIGNER)).rejects.toMatchObject({
        feature: TIER_FEATURES.WORKFLOW_DESIGNER,
        requiredTier: 'pro',
        currentTier: 'solo',
      });
    });

    it('does not throw for solo tenants accessing WORKFLOW_DESIGNER during an active Solo -> Pro trial', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: {
          plan: 'solo',
          solo_pro_trial_end: '2099-04-25T00:00:00.000Z',
        },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.WORKFLOW_DESIGNER)).resolves.toBeUndefined();
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

    it('reverts expired Solo -> Pro trials back to solo access', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: {
          plan: 'solo',
          solo_pro_trial_end: '2000-04-25T00:00:00.000Z',
        },
      } as any);

      // WORKFLOW_DESIGNER stays gated at Pro+, so once the trial expires a
      // Solo tenant is blocked from it again.
      await expect(assertTierAccess(TIER_FEATURES.WORKFLOW_DESIGNER)).rejects.toMatchObject({
        currentTier: 'solo',
      });
    });

    it('does not throw for pro tenants accessing TEAMS_INTEGRATION (moved from premium to pro)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).resolves.toBeUndefined();
    });
  });
});
