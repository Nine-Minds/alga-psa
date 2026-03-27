import { describe, expect, it } from 'vitest';
import {
  TIER_FEATURES,
  TIER_FEATURE_MAP,
  tierHasFeature,
  FEATURE_MINIMUM_TIER,
} from './tierFeatures';

describe('tierFeatures', () => {
  describe('TIER_FEATURES enum', () => {
    it('contains all pro-tier gated features', () => {
      expect(TIER_FEATURES.INTEGRATIONS).toBe('INTEGRATIONS');
      expect(TIER_FEATURES.EXTENSIONS).toBe('EXTENSIONS');
      expect(TIER_FEATURES.MANAGED_EMAIL).toBe('MANAGED_EMAIL');
      expect(TIER_FEATURES.SSO).toBe('SSO');
      expect(TIER_FEATURES.ADVANCED_ASSETS).toBe('ADVANCED_ASSETS');
      expect(TIER_FEATURES.CLIENT_PORTAL_ADMIN).toBe('CLIENT_PORTAL_ADMIN');
      expect(TIER_FEATURES.WORKFLOW_DESIGNER).toBe('WORKFLOW_DESIGNER');
      expect(TIER_FEATURES.MOBILE_ACCESS).toBe('MOBILE_ACCESS');
    });

    it('contains ENTRA_SYNC', () => {
      expect(TIER_FEATURES.ENTRA_SYNC).toBe('ENTRA_SYNC');
    });

    it('contains CIPP', () => {
      expect(TIER_FEATURES.CIPP).toBe('CIPP');
    });
  });

  describe('TIER_FEATURE_MAP', () => {
    it('solo tier has no gated features', () => {
      expect(TIER_FEATURE_MAP.solo).toEqual([]);
    });

    it('pro tier includes all pro-minimum features', () => {
      expect(TIER_FEATURE_MAP.pro).toEqual([
        TIER_FEATURES.INTEGRATIONS,
        TIER_FEATURES.EXTENSIONS,
        TIER_FEATURES.MANAGED_EMAIL,
        TIER_FEATURES.SSO,
        TIER_FEATURES.ADVANCED_ASSETS,
        TIER_FEATURES.CLIENT_PORTAL_ADMIN,
        TIER_FEATURES.WORKFLOW_DESIGNER,
        TIER_FEATURES.MOBILE_ACCESS,
      ]);
    });

    it('premium tier includes all pro and premium features', () => {
      expect(TIER_FEATURE_MAP.premium).toEqual([
        TIER_FEATURES.INTEGRATIONS,
        TIER_FEATURES.EXTENSIONS,
        TIER_FEATURES.MANAGED_EMAIL,
        TIER_FEATURES.SSO,
        TIER_FEATURES.ADVANCED_ASSETS,
        TIER_FEATURES.CLIENT_PORTAL_ADMIN,
        TIER_FEATURES.WORKFLOW_DESIGNER,
        TIER_FEATURES.MOBILE_ACCESS,
        TIER_FEATURES.ENTRA_SYNC,
        TIER_FEATURES.CIPP,
        TIER_FEATURES.TEAMS_INTEGRATION,
      ]);
    });
  });

  describe('tierHasFeature', () => {
    it('returns false for solo on all pro-minimum features', () => {
      expect(tierHasFeature('solo', TIER_FEATURES.INTEGRATIONS)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.EXTENSIONS)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.MANAGED_EMAIL)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.SSO)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.ADVANCED_ASSETS)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.CLIENT_PORTAL_ADMIN)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.WORKFLOW_DESIGNER)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.MOBILE_ACCESS)).toBe(false);
    });

    it('returns true for pro on pro-minimum features', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.INTEGRATIONS)).toBe(true);
      expect(tierHasFeature('pro', TIER_FEATURES.EXTENSIONS)).toBe(true);
      expect(tierHasFeature('pro', TIER_FEATURES.MOBILE_ACCESS)).toBe(true);
    });

    it('tierHasFeature(premium, ENTRA_SYNC) returns true', () => {
      expect(tierHasFeature('premium', TIER_FEATURES.ENTRA_SYNC)).toBe(true);
    });

    it('tierHasFeature(solo, ENTRA_SYNC) returns false', () => {
      expect(tierHasFeature('solo', TIER_FEATURES.ENTRA_SYNC)).toBe(false);
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
    it('maps all new tier features to pro', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.INTEGRATIONS]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.EXTENSIONS]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.MANAGED_EMAIL]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.SSO]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.ADVANCED_ASSETS]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.CLIENT_PORTAL_ADMIN]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.WORKFLOW_DESIGNER]).toBe('pro');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.MOBILE_ACCESS]).toBe('pro');
    });

    it('maps ENTRA_SYNC→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.ENTRA_SYNC]).toBe('premium');
    });

    it('maps CIPP→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.CIPP]).toBe('premium');
    });

    it('maps TEAMS_INTEGRATION→premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.TEAMS_INTEGRATION]).toBe('premium');
    });
  });
});
