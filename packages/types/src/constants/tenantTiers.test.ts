import { describe, expect, it } from 'vitest';
import {
  TENANT_TIERS,
  TenantTier,
  TIER_LABELS,
  isValidTier,
  resolveTier,
} from './tenantTiers';

describe('tenantTiers', () => {
  describe('TENANT_TIERS', () => {
    it('contains exactly [pro, premium]', () => {
      expect(TENANT_TIERS).toEqual(['pro', 'premium']);
      expect(TENANT_TIERS.length).toBe(2);
    });
  });

  describe('TenantTier type', () => {
    it('accepts pro and premium values', () => {
      const pro: TenantTier = 'pro';
      const premium: TenantTier = 'premium';
      expect(pro).toBe('pro');
      expect(premium).toBe('premium');
    });
  });

  describe('TIER_LABELS', () => {
    it('maps pro→Pro, premium→Premium', () => {
      expect(TIER_LABELS.pro).toBe('Pro');
      expect(TIER_LABELS.premium).toBe('Premium');
    });
  });

  describe('isValidTier', () => {
    it('returns true for pro, premium', () => {
      expect(isValidTier('pro')).toBe(true);
      expect(isValidTier('premium')).toBe(true);
    });

    it('returns false for null, undefined, empty string, invalid, basic, test', () => {
      expect(isValidTier(null)).toBe(false);
      expect(isValidTier(undefined)).toBe(false);
      expect(isValidTier('')).toBe(false);
      expect(isValidTier('invalid')).toBe(false);
      expect(isValidTier('basic')).toBe(false);
      expect(isValidTier('test')).toBe(false);
    });
  });

  describe('resolveTier', () => {
    it('resolveTier(pro) returns { tier: pro, isMisconfigured: false }', () => {
      expect(resolveTier('pro')).toEqual({ tier: 'pro', isMisconfigured: false });
    });

    it('resolveTier(premium) returns { tier: premium, isMisconfigured: false }', () => {
      expect(resolveTier('premium')).toEqual({ tier: 'premium', isMisconfigured: false });
    });

    it('resolveTier(null) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier(null)).toEqual({ tier: 'pro', isMisconfigured: true });
    });

    it('resolveTier(undefined) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier(undefined)).toEqual({ tier: 'pro', isMisconfigured: true });
    });

    it('resolveTier(invalid) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier('invalid')).toEqual({ tier: 'pro', isMisconfigured: true });
    });

    it('resolveTier(basic) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier('basic')).toEqual({ tier: 'pro', isMisconfigured: true });
    });
  });
});
