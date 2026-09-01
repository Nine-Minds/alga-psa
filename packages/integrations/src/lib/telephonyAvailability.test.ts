import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getTelephonyAvailability,
  resolveTelephonyAvailability,
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

  it('keeps the client-safe resolver free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTelephonyAvailability');
    expect(serverSource).toContain('export async function getTelephonyAvailability');
  });
});
