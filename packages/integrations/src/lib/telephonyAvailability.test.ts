vi.mock('@shared/services/productAccessGuard', async importOriginal => ({ ...await importOriginal<typeof import('@shared/services/productAccessGuard')>(), assertPsaOnlyTenantAccess: vi.fn(async () => undefined) }));
import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';

import {
  getTelephonyAvailability,
  getTelephonyProviderAvailability,
  resolveTelephonyAvailability,
  TELEPHONY_AVAILABILITY_MESSAGES,
} from './telephonyAvailability';

// Product admission remains independent of the presentation release flag.
afterEach(() => { vi.mocked(assertPsaOnlyTenantAccess).mockReset().mockResolvedValue(undefined); });

describe('telephonyAvailability', () => {
  it('enables telephony for an EE tenant', async () => {
    await expect(getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' }))
      .resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('resolves CE unavailable', async () => {
    await expect(getTelephonyAvailability({ isEnterpriseEdition: false, tenantId: 'tenant-1' }))
      .resolves.toEqual({
        enabled: false,
        reason: 'ce_unavailable',
        message: 'Telephony integrations are only available in Enterprise Edition.',
      });
  });

  it('requires tenant context', () => {
    expect(resolveTelephonyAvailability({ isEnterpriseEdition: true })).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Telephony integrations require tenant context.',
    });
  });

  it('declares a non-empty tier_required message', () => {
    expect(TELEPHONY_AVAILABILITY_MESSAGES.tier_required).toEqual(expect.any(String));
    expect(TELEPHONY_AVAILABILITY_MESSAGES.tier_required.length).toBeGreaterThan(0);
  });

  it('declares a non-empty product_unavailable message', () => {
    expect(TELEPHONY_AVAILABILITY_MESSAGES.product_unavailable).toEqual(expect.any(String));
    expect(TELEPHONY_AVAILABILITY_MESSAGES.product_unavailable.length).toBeGreaterThan(0);
  });

  it('keeps the client-safe resolver free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTelephonyAvailability');
    expect(serverSource).toContain('export async function getTelephonyAvailability');
    expect(serverSource).not.toContain('isFeatureFlagEnabled');
  });

  it('rejects an excluded product before exposing integration availability', async () => {
    vi.mocked(assertPsaOnlyTenantAccess).mockRejectedValue(new ProductAccessError('telephony_integration', 'co_managed'));
    await expect(getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'customer' })).resolves.toMatchObject({ enabled: false, reason: 'product_unavailable' });
    expect(assertPsaOnlyTenantAccess).toHaveBeenCalledWith('customer', 'telephony_integration');
  });

  it('does not convert database admission failure into enabled availability', async () => {
    vi.mocked(assertPsaOnlyTenantAccess).mockRejectedValue(new Error('Unavailable database'));
    await expect(getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'customer' })).rejects.toThrow('Unavailable database');
  });
});

describe('getTelephonyProviderAvailability', () => {
  it('returns ce_unavailable unchanged for 3cx outside Enterprise Edition', async () => {
    await expect(getTelephonyProviderAvailability('3cx', {
      isEnterpriseEdition: false,
      tenantId: 'tenant-1',
    })).resolves.toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: TELEPHONY_AVAILABILITY_MESSAGES.ce_unavailable,
    });
  });

  it('returns tenant_not_configured unchanged for 3cx without a tenant', async () => {
    await expect(getTelephonyProviderAvailability('3cx', {
      isEnterpriseEdition: true,
    })).resolves.toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: TELEPHONY_AVAILABILITY_MESSAGES.tenant_not_configured,
    });
  });

  it('returns tier_required for a 3cx tenant below pro', async () => {
    await expect(getTelephonyProviderAvailability('3cx', {
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      resolveTier: async () => 'solo',
    })).resolves.toEqual({
      enabled: false,
      reason: 'tier_required',
      message: TELEPHONY_AVAILABILITY_MESSAGES.tier_required,
    });
  });

  it('enables 3cx for a pro tenant on EE', async () => {
    await expect(getTelephonyProviderAvailability('3cx', {
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      resolveTier: async () => 'pro',
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('adds no tier checks for teams-phone even on a solo tenant', async () => {
    const resolveTier = vi.fn(async () => 'solo' as const);
    await expect(getTelephonyProviderAvailability('teams-phone', {
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      resolveTier,
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it('never consults the feature-flag checker for either provider', async () => {
    const checker = vi.fn(async () => true);
    registerFeatureFlagChecker(checker);
    try {
      await getTelephonyProviderAvailability('3cx', {
        isEnterpriseEdition: true,
        tenantId: 'tenant-1',
        resolveTier: async () => 'pro',
      });
      await getTelephonyProviderAvailability('teams-phone', {
        isEnterpriseEdition: true,
        tenantId: 'tenant-1',
      });
    } finally {
      registerFeatureFlagChecker(undefined as any);
    }
    expect(checker).not.toHaveBeenCalled();
  });

  // Precedence contract: product admission outranks commercial tier.
  it('reports product_unavailable (not tier_required) when both guards would reject', async () => {
    vi.mocked(assertPsaOnlyTenantAccess).mockRejectedValue(new ProductAccessError('telephony_integration', 'co_managed'));
    const resolveTier = vi.fn(async () => 'solo' as const);
    await expect(getTelephonyProviderAvailability('3cx', {
      isEnterpriseEdition: true,
      tenantId: 'customer',
      resolveTier,
    })).resolves.toEqual({
      enabled: false,
      reason: 'product_unavailable',
      message: TELEPHONY_AVAILABILITY_MESSAGES.product_unavailable,
    });
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it('applies the product guard to per-provider availability', async () => {
    await getTelephonyProviderAvailability('teams-phone', {
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
    });
    expect(assertPsaOnlyTenantAccess).toHaveBeenCalledWith('tenant-1', 'telephony_integration');
  });
});
