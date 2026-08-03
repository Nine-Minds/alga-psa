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
    it('contains exactly [essentials, solo, pro] in ascending order', () => {
      expect(TENANT_TIERS).toEqual(['essentials', 'solo', 'pro']);
      expect(TENANT_TIERS.length).toBe(3);
    });
  });

  describe('TenantTier type', () => {
    it('accepts essentials, solo, and pro values', () => {
      const essentials: TenantTier = 'essentials';
      const solo: TenantTier = 'solo';
      const pro: TenantTier = 'pro';
      expect(essentials).toBe('essentials');
      expect(solo).toBe('solo');
      expect(pro).toBe('pro');
    });
  });

  describe('TIER_LABELS', () => {
    it('maps essentials→Essentials, solo→Solo, and pro→Pro', () => {
      expect(TIER_LABELS.essentials).toBe('Essentials');
      expect(TIER_LABELS.solo).toBe('Solo');
      expect(TIER_LABELS.pro).toBe('Pro');
    });
  });

  describe('TIER_RANK', () => {
    it('maps essentials→-1, solo→0, and pro→1', () => {
      expect(TIER_RANK.essentials).toBe(-1);
      expect(TIER_RANK.solo).toBe(0);
      expect(TIER_RANK.pro).toBe(1);
    });
  });

  describe('isValidTier', () => {
    it('returns true for essentials, solo, and pro', () => {
      expect(isValidTier('essentials')).toBe(true);
      expect(isValidTier('solo')).toBe(true);
      expect(isValidTier('pro')).toBe(true);
    });

    it('returns false for null, undefined, empty string, invalid, basic, test', () => {
      expect(isValidTier(null)).toBe(false);
      expect(isValidTier(undefined)).toBe(false);
      expect(isValidTier('')).toBe(false);
      expect(isValidTier('invalid')).toBe(false);
      expect(isValidTier('basic')).toBe(false);
      expect(isValidTier('test')).toBe(false);
      expect(isValidTier('premium')).toBe(false);
    });
  });

  describe('resolveTier', () => {
    it('resolveTier(essentials) returns { tier: essentials, isMisconfigured: false }', () => {
      expect(resolveTier('essentials')).toEqual({ tier: 'essentials', isMisconfigured: false });
    });

    it('resolveTier(solo) returns { tier: solo, isMisconfigured: false }', () => {
      expect(resolveTier('solo')).toEqual({ tier: 'solo', isMisconfigured: false });
    });

    it('resolveTier(pro) returns { tier: pro, isMisconfigured: false }', () => {
      expect(resolveTier('pro')).toEqual({ tier: 'pro', isMisconfigured: false });
    });

    it('treats legacy premium values as misconfigured until the data migration runs', () => {
      expect(resolveTier('premium')).toEqual({ tier: 'pro', isMisconfigured: true });
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
      expect(tierAtLeast('essentials', 'essentials')).toBe(true);
      expect(tierAtLeast('solo', 'essentials')).toBe(true);
      expect(tierAtLeast('solo', 'solo')).toBe(true);
      expect(tierAtLeast('pro', 'solo')).toBe(true);
    });

    it('returns false when the current tier is below the minimum tier', () => {
      expect(tierAtLeast('essentials', 'solo')).toBe(false);
      expect(tierAtLeast('solo', 'pro')).toBe(false);
    });
  });
});
