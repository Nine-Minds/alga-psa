import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getTeamsAvailability, resolveTeamsAvailability } from './teamsAvailability';

describe('teamsAvailability', () => {
  it('enables Teams for an EE tenant', async () => {
    await expect(getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('resolves CE as unavailable', async () => {
    await expect(getTeamsAvailability({ isEnterpriseEdition: false, tenantId: 'tenant-1' })).resolves.toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
  });

  it('keeps tenant-not-configured distinct from other disabled results', () => {
    expect(resolveTeamsAvailability({ isEnterpriseEdition: true })).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('allows EE-only client checks without tenant context when it is not required', async () => {
    await expect(getTeamsAvailability({
      isEnterpriseEdition: true,
      requireTenantContext: false,
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('keeps client-safe helpers free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTeamsAvailability');
    expect(serverSource).toContain('export async function getTeamsAvailability');
  });
});
