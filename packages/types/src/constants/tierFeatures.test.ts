import { describe, expect, it } from 'vitest';
import {
  TIER_FEATURES,
  TIER_FEATURE_MAP,
  tierHasFeature,
  FEATURE_MINIMUM_TIER,
} from './tierFeatures';

describe('tierFeatures', () => {
  describe('TIER_FEATURES enum', () => {
    it('contains all tier-gated feature keys', () => {
      expect(TIER_FEATURES.INTEGRATIONS).toBe('INTEGRATIONS');
      expect(TIER_FEATURES.EXTENSIONS).toBe('EXTENSIONS');
      expect(TIER_FEATURES.MANAGED_EMAIL).toBe('MANAGED_EMAIL');
      expect(TIER_FEATURES.SSO).toBe('SSO');
      expect(TIER_FEATURES.ADVANCED_ASSETS).toBe('ADVANCED_ASSETS');
      expect(TIER_FEATURES.CLIENT_PORTAL_ADMIN).toBe('CLIENT_PORTAL_ADMIN');
      expect(TIER_FEATURES.WORKFLOW_DESIGNER).toBe('WORKFLOW_DESIGNER');
      expect(TIER_FEATURES.MOBILE_ACCESS).toBe('MOBILE_ACCESS');
      expect(TIER_FEATURES.TEAMS_INTEGRATION).toBe('TEAMS_INTEGRATION');
      expect(TIER_FEATURES.ENTRA_SYNC).toBe('ENTRA_SYNC');
      expect(TIER_FEATURES.CIPP).toBe('CIPP');
    });
  });

  describe('TIER_FEATURE_MAP', () => {
    it('solo tier has access to all solo-minimum features', () => {
      expect(TIER_FEATURE_MAP.solo).toEqual([
        TIER_FEATURES.INTEGRATIONS,
        TIER_FEATURES.EXTENSIONS,
        TIER_FEATURES.MANAGED_EMAIL,
        TIER_FEATURES.SSO,
        TIER_FEATURES.ADVANCED_ASSETS,
        TIER_FEATURES.CLIENT_PORTAL_ADMIN,
        TIER_FEATURES.MOBILE_ACCESS,
      ]);
    });

    it('pro tier includes solo features plus workflow designer and Teams integration', () => {
      expect(TIER_FEATURE_MAP.pro).toEqual([
        TIER_FEATURES.INTEGRATIONS,
        TIER_FEATURES.EXTENSIONS,
        TIER_FEATURES.MANAGED_EMAIL,
        TIER_FEATURES.SSO,
        TIER_FEATURES.ADVANCED_ASSETS,
        TIER_FEATURES.CLIENT_PORTAL_ADMIN,
        TIER_FEATURES.WORKFLOW_DESIGNER,
        TIER_FEATURES.MOBILE_ACCESS,
        TIER_FEATURES.TEAMS_INTEGRATION,
      ]);
    });

    it('premium tier includes all features', () => {
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
    it('solo has access to the newly unlocked features', () => {
      expect(tierHasFeature('solo', TIER_FEATURES.INTEGRATIONS)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.EXTENSIONS)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.MANAGED_EMAIL)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.SSO)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.ADVANCED_ASSETS)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.CLIENT_PORTAL_ADMIN)).toBe(true);
      expect(tierHasFeature('solo', TIER_FEATURES.MOBILE_ACCESS)).toBe(true);
    });

    it('solo cannot access workflow designer or Teams integration', () => {
      expect(tierHasFeature('solo', TIER_FEATURES.WORKFLOW_DESIGNER)).toBe(false);
      expect(tierHasFeature('solo', TIER_FEATURES.TEAMS_INTEGRATION)).toBe(false);
    });

    it('pro has access to workflow designer and Teams integration', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.WORKFLOW_DESIGNER)).toBe(true);
      expect(tierHasFeature('pro', TIER_FEATURES.TEAMS_INTEGRATION)).toBe(true);
    });

    it('pro cannot access Premium-only features', () => {
      expect(tierHasFeature('pro', TIER_FEATURES.ENTRA_SYNC)).toBe(false);
      expect(tierHasFeature('pro', TIER_FEATURES.CIPP)).toBe(false);
    });

    it('premium has access to all features', () => {
      expect(tierHasFeature('premium', TIER_FEATURES.INTEGRATIONS)).toBe(true);
      expect(tierHasFeature('premium', TIER_FEATURES.WORKFLOW_DESIGNER)).toBe(true);
      expect(tierHasFeature('premium', TIER_FEATURES.TEAMS_INTEGRATION)).toBe(true);
      expect(tierHasFeature('premium', TIER_FEATURES.ENTRA_SYNC)).toBe(true);
      expect(tierHasFeature('premium', TIER_FEATURES.CIPP)).toBe(true);
    });
  });

  describe('FEATURE_MINIMUM_TIER', () => {
    it('maps previously-Pro-only features to solo', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.INTEGRATIONS]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.EXTENSIONS]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.MANAGED_EMAIL]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.SSO]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.ADVANCED_ASSETS]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.CLIENT_PORTAL_ADMIN]).toBe('solo');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.MOBILE_ACCESS]).toBe('solo');
    });

    it('keeps workflow designer at pro', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.WORKFLOW_DESIGNER]).toBe('pro');
    });

    it('moves Teams integration to pro', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.TEAMS_INTEGRATION]).toBe('pro');
    });

    it('keeps ENTRA_SYNC and CIPP at premium', () => {
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.ENTRA_SYNC]).toBe('premium');
      expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.CIPP]).toBe('premium');
    });
  });
});
