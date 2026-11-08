import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verify = vi.hoisted(() => ({ verifyLicense: vi.fn(), clearLicenseVerifyCache: vi.fn() }));
vi.mock('./verify-license', () => verify);
const dbCalls = vi.hoisted(() => ({ tenantInserts: [] as unknown[], tenantTables: [] as string[] }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      dbCalls.tenantTables.push(name);
      return {
        forUpdate: () => ({ first: async () => ({ tenant: 'x' }) }),
        insert: (row: unknown) => { dbCalls.tenantInserts.push(row); return { onConflict: () => ({ merge: async () => undefined }) }; },
      };
    },
  }),
}));

import { activateTenantPsaLicense, getTenantOwnLicenseInput, resetTenantLicenseTableProbe } from './tenant-license-state';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = Date.UTC(2026, 9, 28, 12);
const claims = (over: Record<string, unknown> = {}) => ({ valid: true, claims: { iss: 'nineminds-license', sub: 'lic_1', tier: 'pro', aud: TENANT,
  iat: 0, exp: Math.floor(NOW / 1000) + 3600, seats: 10, ...over } });

/** A transaction double: records every write to `license_state` (there must be none). */
function fakeTrx(dbNow = NOW) {
  const singletonWrites: string[] = [];
  const trx: any = (table: string) => ({
    first: async () => (table === 'license_state' ? { id: 1 } : undefined),
    insert: () => { singletonWrites.push(table); }, update: () => { singletonWrites.push(table); }, del: () => { singletonWrites.push(table); },
  });
  trx.isTransaction = true;
  trx.raw = () => 'clock_timestamp()';
  trx.select = () => ({ first: async () => ({ at: new Date(dbNow) }) });
  return { trx, singletonWrites };
}

beforeEach(() => {
  process.env.ALGA_TENANT_LICENSE_CLAIMS = 'enabled';
  verify.verifyLicense.mockReset(); dbCalls.tenantInserts.length = 0; dbCalls.tenantTables.length = 0; resetTenantLicenseTableProbe();
});
afterEach(() => { delete process.env.ALGA_TENANT_LICENSE_CLAIMS; });

describe('tenant licence claim verification (A4)', () => {
  it('stages a claim bound to the tenant and never writes the installation singleton', async () => {
    verify.verifyLicense.mockReturnValue(claims());
    const { trx, singletonWrites } = fakeTrx();
    await activateTenantPsaLicense(trx, TENANT, 'a.b.c');
    expect(dbCalls.tenantInserts).toHaveLength(1);
    expect(dbCalls.tenantInserts[0]).toMatchObject({ tenant: TENANT, license_id: 'lic_1', seats: 10 });
    expect(singletonWrites).toEqual([]);
  });

  it.each([
    ['aud for another tenant', { aud: '22222222-2222-4222-8222-222222222222' }],
    ['no aud', { aud: undefined }],
    ['a non-pro tier', { tier: 'enterprise' }],
  ])('refuses a token with %s', async (_name, over) => {
    verify.verifyLicense.mockReturnValue(claims(over));
    await expect(activateTenantPsaLicense(fakeTrx().trx, TENANT, 'a.b.c')).rejects.toThrow('bound to this tenant');
    expect(dbCalls.tenantInserts).toEqual([]);
  });

  it('refuses a verification failure', async () => {
    verify.verifyLicense.mockReturnValue({ valid: false, reason: 'bad_signature' });
    await expect(activateTenantPsaLicense(fakeTrx().trx, TENANT, 'a.b.c')).rejects.toThrow('bound to this tenant');
  });

  it('re-checks expiry on the database clock even though verifyLicense caches valid results', async () => {
    verify.verifyLicense.mockReturnValue(claims({ exp: Math.floor(NOW / 1000) + 3600 }));
    await expect(activateTenantPsaLicense(fakeTrx(NOW + 7200_000).trx, TENANT, 'a.b.c')).rejects.toThrow('expired');
    expect(dbCalls.tenantInserts).toEqual([]);
  });

  it('is inert unless claims are enabled', async () => {
    delete process.env.ALGA_TENANT_LICENSE_CLAIMS;
    await expect(activateTenantPsaLicense(fakeTrx().trx, TENANT, 'a.b.c')).rejects.toThrow('not enabled');
    const db: any = { schema: { hasTable: vi.fn() } };
    expect(await getTenantOwnLicenseInput(TENANT, db)).toBeNull();
    expect(db.schema.hasTable).not.toHaveBeenCalled();
  });

  it('probes for the table once per process, not once per lookup', async () => {
    const db: any = { isTransaction: false, schema: { hasTable: vi.fn(async () => false) } };
    for (let i = 0; i < 5; i++) expect(await getTenantOwnLicenseInput(TENANT, db)).toBeNull();
    expect(db.schema.hasTable).toHaveBeenCalledTimes(1);
  });
});
