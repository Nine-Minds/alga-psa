import { describe, expect, it } from 'vitest';
import {
  TIER_FEATURES,
  TIER_FEATURE_MAP,
  tierHasFeature,
  FEATURE_MINIMUM_TIER,
} from './tierFeatures';

describe('tierFeatures', () => {
  describe('TIER_FEATURES enum', () => {
    it('contains INVOICE_DESIGNER', () => {
      expect(TIER_FEATURES.INVOICE_DESIGNER).toBe('INVOICE_DESIGNER');
    });
  });

  describe('TIER_FEATURE_MAP', () => {
    it('pro tier has no gated features', () => {
      expect(TIER_FEATURE_MAP.pro).toEqual([]);
    });

    it('premium tier includes INVOICE_DESIGNER', () => {
      expect(TIER_FEATURE_MAP.premium).toContain(TIER_FEATURES.INVOICE_DESIGNER);
    });
  });

  describe('tierHasFeature', () => {
    it('tierHasFeature(premium, INVOICE_DESIGNER) returns true', () => {
      expect(tierHasFeature('premium', TIER_FEATURES.INVOICE_DESIGNER)).toBe(true);
    });

    it('tierHasFeature(pro, INVOICE_DESIGNER) returns false', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.INVOICE_DESIGNER)).toBe(false);
    });
  });

  describe('FEATURE_MINIMUM_TIER', () => {
    it('maps INVOICE_DESIGNER→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.INVOICE_DESIGNER]).toBe('premium');
    });
  });
});
