import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const tenantAddOns: Array<{ tenant: string; addon_key: string; expires_at: string | null }> = [];

  const knexMock: any = vi.fn((table: string) => {
    const filters: Record<string, unknown>[] = [];
    const query = {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return query;
      },
      andWhere(callback: (builder: any) => void) {
        callback({ whereNull: () => ({ orWhere: () => undefined }) });
        return query;
      },
      async first() {
        const rows = table === 'tenant_addons' ? tenantAddOns : [];
        return rows.find((row) => filters.every((filter) => Object.entries(filter).every(([key, value]) => (row as any)[key] === value)));
      },
    };
    return query;
  });
  knexMock.fn = { now: vi.fn(() => 'now()') };

  return {
    tenantAddOns,
    createTenantKnexMock: vi.fn(async () => ({ knex: knexMock })),
    knexMock,
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table),
  }),
}));

import {
  getTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailability';

describe('teamsAvailability', () => {
  beforeEach(() => {
    hoisted.tenantAddOns.length = 0;
    hoisted.createTenantKnexMock.mockClear();
    hoisted.knexMock.mockClear();
  });

  it('enables Teams for EE tenants with tenant context and active Teams add-on', async () => {
    hoisted.tenantAddOns.push({ tenant: 'tenant-1', addon_key: 'teams', expires_at: null });

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

  it('rejects EE tenants without the Teams add-on', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'addon_required',
      message: 'Microsoft Teams integration requires the Teams add-on.',
    });
  });

  it('resolves CE as unavailable before checking add-ons', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: false,
      tenantId: 'tenant-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
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

  it('requires tenant context for server-side availability checks before checking add-ons', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Microsoft Teams integration requires tenant context.',
    });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('allows EE-only client checks without tenant context when tenant context is not required', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      requireTenantContext: false,
      userId: '   ',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
    });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('keeps client-safe Teams availability helpers in a module without database imports', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toMatch(/['"]use server['"]/);
    expect(clientSafeSource).not.toContain('@alga-psa/db');
    expect(clientSafeSource).toContain('export function resolveTeamsAvailability');
    expect(serverSource).toContain('export async function getTeamsAvailability');
  });
});
