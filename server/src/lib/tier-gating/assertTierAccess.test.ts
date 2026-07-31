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
      const error = new TierAccessError(TIER_FEATURES.ENTRA_SYNC, 'pro', 'solo');
      expect(error.name).toBe('TierAccessError');
      expect(error.feature).toBe(TIER_FEATURES.ENTRA_SYNC);
      expect(error.requiredTier).toBe('pro');
      expect(error.currentTier).toBe('solo');
      expect(error.message).toContain('Pro');
    });
  });

  describe('assertTierAccess function', () => {
    it('allows a Pro tenant to access ENTRA_SYNC', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).resolves.toBeUndefined();
    });

    it('allows a Premium tenant to access ENTRA_SYNC', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'premium' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).resolves.toBeUndefined();
    });

    it('throws TierAccessError for a Solo tenant accessing ENTRA_SYNC', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).rejects.toMatchObject({
        feature: TIER_FEATURES.ENTRA_SYNC,
        requiredTier: 'pro',
        currentTier: 'solo',
      });
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

    it('does not throw for solo tenant accessing WORKFLOW_DESIGNER (now unlocked at solo)', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.WORKFLOW_DESIGNER)).resolves.toBeUndefined();
    });

    it('throws TierAccessError for solo tenant accessing TEAMS_INTEGRATION', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'solo' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).rejects.toThrow(TierAccessError);
      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).rejects.toMatchObject({
        feature: TIER_FEATURES.TEAMS_INTEGRATION,
        requiredTier: 'pro',
        currentTier: 'solo',
      });
    });

    it('throws for solo tenants accessing add-on-only TEAMS_INTEGRATION during an active Solo -> Pro trial', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: {
          plan: 'solo',
          solo_pro_trial_end: '2099-04-25T00:00:00.000Z',
        },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).rejects.toThrow(TierAccessError);
    });

    it('allows a NULL plan tenant because the legacy fallback resolves to Pro', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: null },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.ENTRA_SYNC)).resolves.toBeUndefined();
    });

    it('reverts expired Solo -> Pro trials back to solo access', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: {
          plan: 'solo',
          solo_pro_trial_end: '2000-04-25T00:00:00.000Z',
        },
      } as any);

      // TEAMS_INTEGRATION remains add-on-only, so the expired trial is still blocked.
      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).rejects.toMatchObject({
        currentTier: 'solo',
      });
    });

    it('throws for pro tenants accessing add-on-only TEAMS_INTEGRATION by tier', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { plan: 'pro' },
      } as any);

      await expect(assertTierAccess(TIER_FEATURES.TEAMS_INTEGRATION)).rejects.toThrow(TierAccessError);
    });
  });
});
