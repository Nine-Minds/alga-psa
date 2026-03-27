import { describe, expect, it } from 'vitest';
import {
  TENANT_TIERS,
  TIER_RANK,
  TenantTier,
  TIER_LABELS,
  isValidTier,
  resolveTier,
  tierAtLeast,
} from './tenantTiers';

describe('tenantTiers', () => {
  describe('TENANT_TIERS', () => {
    it('contains exactly [solo, pro, premium]', () => {
      expect(TENANT_TIERS).toEqual(['solo', 'pro', 'premium']);
      expect(TENANT_TIERS.length).toBe(3);
    });
  });

  describe('TenantTier type', () => {
    it('accepts solo, pro, and premium values', () => {
      const solo: TenantTier = 'solo';
      const pro: TenantTier = 'pro';
      const premium: TenantTier = 'premium';
      expect(solo).toBe('solo');
      expect(pro).toBe('pro');
      expect(premium).toBe('premium');
    });
  });

  describe('TIER_LABELS', () => {
    it('maps solo→Solo, pro→Pro, premium→Premium', () => {
      expect(TIER_LABELS.solo).toBe('Solo');
      expect(TIER_LABELS.pro).toBe('Pro');
      expect(TIER_LABELS.premium).toBe('Premium');
    });
  });

  describe('TIER_RANK', () => {
    it('maps solo→0, pro→1, premium→2', () => {
      expect(TIER_RANK.solo).toBe(0);
      expect(TIER_RANK.pro).toBe(1);
      expect(TIER_RANK.premium).toBe(2);
    });
  });

  describe('isValidTier', () => {
    it('returns true for solo, pro, premium', () => {
      expect(isValidTier('solo')).toBe(true);
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
    it('resolveTier(solo) returns { tier: solo, isMisconfigured: false }', () => {
      expect(resolveTier('solo')).toEqual({ tier: 'solo', isMisconfigured: false });
    });

    it('resolveTier(pro) returns { tier: pro, isMisconfigured: false }', () => {
      expect(resolveTier('pro')).toEqual({ tier: 'pro', isMisconfigured: false });
    });

    it('resolveTier(premium) returns { tier: premium, isMisconfigured: false }', () => {
      expect(resolveTier('premium')).toEqual({ tier: 'premium', isMisconfigured: false });
    });

    it('resolveTier(null) returns { tier: pro, isMisconfigured: false }', () => {
      expect(resolveTier(null)).toEqual({ tier: 'pro', isMisconfigured: false });
    });

    it('resolveTier(invalid) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier('invalid')).toEqual({ tier: 'pro', isMisconfigured: true });
    });

    it('resolveTier(basic) returns { tier: pro, isMisconfigured: true }', () => {
      expect(resolveTier('basic')).toEqual({ tier: 'pro', isMisconfigured: true });
    });
  });

  describe('tierAtLeast', () => {
    it('returns true when the current tier meets the minimum tier', () => {
      expect(tierAtLeast('solo', 'solo')).toBe(true);
      expect(tierAtLeast('pro', 'solo')).toBe(true);
      expect(tierAtLeast('premium', 'pro')).toBe(true);
    });

    it('returns false when the current tier is below the minimum tier', () => {
      expect(tierAtLeast('solo', 'pro')).toBe(false);
      expect(tierAtLeast('pro', 'premium')).toBe(false);
    });
  });
});
