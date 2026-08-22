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
  getTelephonyAvailability,
  resolveTelephonyAvailability,
  tenantHasTelephonyAddOn,
} from './telephonyAvailability';

describe('telephonyAvailability', () => {
  beforeEach(() => {
    hoisted.tenantAddOns.length = 0;
    hoisted.createTenantKnexMock.mockClear();
    hoisted.knexMock.mockClear();
  });

  it('T003: EE tenant with the telephony add-on is enabled', async () => {
    hoisted.tenantAddOns.push({ tenant: 'tenant-1', addon_key: 'telephony', expires_at: null });

    await expect(
      getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' }),
    ).resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('T003: EE tenant without the add-on resolves addon_required', async () => {
    await expect(
      getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' }),
    ).resolves.toEqual({
      enabled: false,
      reason: 'addon_required',
      message: 'Telephony integrations require the Telephony add-on.',
    });
  });

  it('T003: CE resolves unavailable before touching the database', async () => {
    await expect(
      getTelephonyAvailability({ isEnterpriseEdition: false, tenantId: 'tenant-1' }),
    ).resolves.toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: 'Telephony integrations are only available in Enterprise Edition.',
    });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('requires tenant context before checking add-ons', () => {
    expect(resolveTelephonyAvailability({ isEnterpriseEdition: true })).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Telephony integrations require tenant context.',
    });
  });

  it('T002: the gate is false without a row and true for an unexpired row', async () => {
    await expect(tenantHasTelephonyAddOn('tenant-1')).resolves.toBe(false);

    hoisted.tenantAddOns.push({ tenant: 'tenant-1', addon_key: 'telephony', expires_at: null });
    await expect(tenantHasTelephonyAddOn('tenant-1')).resolves.toBe(true);
  });

  it('keeps the client-safe resolver free of database imports', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toMatch(/['"]use server['"]/);
    expect(clientSafeSource).not.toContain('@alga-psa/db');
    expect(clientSafeSource).toContain('export function resolveTelephonyAvailability');
    expect(serverSource).toContain('export async function getTelephonyAvailability');
  });
});
