import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailability';

describe('teamsAvailability', () => {
  it('enables Teams for EE tenants with tenant context', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
    });
  });

  it('resolves CE as unavailable', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: false,
      tenantId: 'tenant-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
  });

  it('keeps tenant-not-configured distinct from other disabled results for server-side runtime checks', () => {
    expect(
      resolveTeamsAvailability({
        isEnterpriseEdition: true,
      })
    ).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('requires tenant context for server-side availability checks', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('ignores blank user IDs and returns enabled for EE tenant contexts', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: '   ',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
    });
  });

  it('keeps the shared Teams availability helpers outside use-server modules so UI and action code can import the same file safely', () => {
    const moduleSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(moduleSource).not.toMatch(/['"]use server['"]/);
    expect(moduleSource).toContain('export function resolveTeamsAvailability');
    expect(moduleSource).toContain('export async function getTeamsAvailability');
  });
});
