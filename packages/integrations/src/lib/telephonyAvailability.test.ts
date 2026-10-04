import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';

import {
  getTelephonyAvailability,
  getTelephonyProviderAvailability,
  resolveTelephonyAvailability,
  TELEPHONY_AVAILABILITY_MESSAGES,
} from './telephonyAvailability';

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

  it('keeps the client-safe resolver free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTelephonyAvailability');
    expect(serverSource).toContain('export async function getTelephonyAvailability');
    expect(serverSource).not.toContain('isFeatureFlagEnabled');
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
});
