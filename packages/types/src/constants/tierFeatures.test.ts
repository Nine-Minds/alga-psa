import { describe, expect, it } from 'vitest';
import {
  TIER_FEATURES,
  TIER_FEATURE_MAP,
  tierHasFeature,
  FEATURE_MINIMUM_TIER,
} from './tierFeatures';

describe('tierFeatures', () => {
  describe('TIER_FEATURES enum', () => {
    it('contains ENTRA_SYNC', () => {
      expect(TIER_FEATURES.ENTRA_SYNC).toBe('ENTRA_SYNC');
    });

    it('contains CIPP', () => {
      expect(TIER_FEATURES.CIPP).toBe('CIPP');
    });
  });

  describe('TIER_FEATURE_MAP', () => {
    it('pro tier has no gated features', () => {
      expect(TIER_FEATURE_MAP.pro).toEqual([]);
    });

    it('premium tier includes ENTRA_SYNC', () => {
      expect(TIER_FEATURE_MAP.premium).toContain(TIER_FEATURES.ENTRA_SYNC);
    });

    it('premium tier includes CIPP', () => {
      expect(TIER_FEATURE_MAP.premium).toContain(TIER_FEATURES.CIPP);
    });
  });

  describe('tierHasFeature', () => {
    it('tierHasFeature(premium, ENTRA_SYNC) returns true', () => {
      expect(tierHasFeature('premium', TIER_FEATURES.ENTRA_SYNC)).toBe(true);
    });

    it('tierHasFeature(pro, ENTRA_SYNC) returns false', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.ENTRA_SYNC)).toBe(false);
    });

    it('tierHasFeature(premium, CIPP) returns true', () => {
      expect(tierHasFeature('premium', TIER_FEATURES.CIPP)).toBe(true);
    });

    it('tierHasFeature(pro, CIPP) returns false', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.CIPP)).toBe(false);
    });
  });

  describe('FEATURE_MINIMUM_TIER', () => {
    it('maps ENTRA_SYNC→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.ENTRA_SYNC]).toBe('premium');
    });

    it('maps CIPP→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.CIPP]).toBe('premium');
    });
  });
});
