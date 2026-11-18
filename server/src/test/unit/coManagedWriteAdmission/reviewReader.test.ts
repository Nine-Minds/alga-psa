import { afterEach, describe, expect, it, vi } from 'vitest';
import { admitTenantWrite, invalidateWriteAdmission, noteTenantProductCode, resetWriteAdmissionResolver } from '@alga-psa/db';
import { clearWriteAdmissionCacheForTests } from '@alga-psa/db/testing';
import { installCoManagedReviewAdmission } from '@alga-psa/licensing/co-managed-write-admission';
import { CO_MANAGED_TENANT, createFakeKnex, PSA_TENANT } from './fakeKnex';

afterEach(() => {
  resetWriteAdmissionResolver();
  clearWriteAdmissionCacheForTests();
  vi.unstubAllEnvs();
});

describe('isolated review admission', () => {
  it('uses the reader for the selected tenant, caches and invalidates it, and honors the kill switch', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FORCE_CAPABILITIES', '');
    const db = createFakeKnex();
    const readState = vi.fn(async () => ({ state: 'read_only', canWrite: false, graceEndsAt: null } as const));
    try {
      noteTenantProductCode(CO_MANAGED_TENANT, 'psa');
      installCoManagedReviewAdmission({ tenant: CO_MANAGED_TENANT, readState });
      const admit = (tenant: string) => admitTenantWrite(db.knex, tenant, { operation: 'review' });
      await expect(admit(CO_MANAGED_TENANT)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      await expect(admit(CO_MANAGED_TENANT)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      expect(readState).toHaveBeenCalledTimes(1);
      await expect(admit(PSA_TENANT)).resolves.toBeUndefined();
      expect(readState).toHaveBeenCalledTimes(1);
      const query: any = { where: () => query, first: async () => ({ product_code: 'co_managed' }) };
      const anotherCoManaged = (() => query) as any;
      await expect(admitTenantWrite(anotherCoManaged, 'another-co-managed', { operation: 'review' })).resolves.toBeUndefined();
      expect(readState).toHaveBeenCalledTimes(1);
      invalidateWriteAdmission(CO_MANAGED_TENANT);
      await expect(admit(CO_MANAGED_TENANT)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
      expect(readState).toHaveBeenCalledTimes(2);
      vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
      await expect(admit(CO_MANAGED_TENANT)).resolves.toBeUndefined();
      expect(readState).toHaveBeenCalledTimes(2);
    } finally {
      await db.destroy();
    }
  });
});
