import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the tenant's tenant_settings row, so the real
// read-merge-write runs against something observable.
const tenantSettingsRow = vi.hoisted(() => ({ current: null as null | { settings: any } }));

vi.mock('@alga-psa/db', () => {
  const makeBuilder = () => {
    const builder: any = {
      select: () => builder,
      forUpdate: () => builder,
      first: async () => tenantSettingsRow.current,
      update: async (patch: any) => {
        tenantSettingsRow.current = {
          settings: typeof patch.settings === 'string' ? JSON.parse(patch.settings) : patch.settings
        };
        return 1;
      },
      insert: (row: any) => {
        const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
        const chain: any = {
          onConflict: () => chain,
          merge: async () => {
            tenantSettingsRow.current = { settings };
            return 1;
          }
        };
        return chain;
      }
    };
    return builder;
  };

  return { tenantDb: () => ({ table: () => makeBuilder() }) };
});

import {
  getTenantQboEnvironmentSetting,
  setTenantQboEnvironmentSetting
} from './qboEnvironmentSettings';

const TENANT = 'tenant-env-settings';

const knexStub: any = {
  table: () => ({
    insert: (row: any) => {
      const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
      const chain: any = {
        onConflict: () => chain,
        merge: async () => {
          tenantSettingsRow.current = { settings };
          return 1;
        }
      };
      return chain;
    }
  }),
  fn: { now: () => 'now()' },
  transaction: async (cb: any) => cb(knexStub)
};

describe('qboEnvironmentSettings', () => {
  beforeEach(() => {
    tenantSettingsRow.current = null;
  });

  it('reports no choice when the tenant has no settings row', async () => {
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBeNull();
  });

  it('reports no choice when the qbo key is absent or malformed', async () => {
    tenantSettingsRow.current = { settings: { qboAutomatedSalesTax: { realms: ['r-1'] } } };
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBeNull();

    tenantSettingsRow.current = { settings: { qbo: 'sandbox' } };
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBeNull();

    tenantSettingsRow.current = { settings: { qbo: { environment: 'staging' } } };
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBeNull();

    tenantSettingsRow.current = { settings: { qbo: { environment: 42 } } };
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBeNull();
  });

  it('normalizes case and surrounding whitespace', async () => {
    tenantSettingsRow.current = { settings: { qbo: { environment: '  SANDBOX ' } } };
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBe('sandbox');
  });

  it('writes the environment into a fresh settings row', async () => {
    await expect(setTenantQboEnvironmentSetting(knexStub, TENANT, 'sandbox')).resolves.toBe('sandbox');
    expect(tenantSettingsRow.current?.settings).toEqual({ qbo: { environment: 'sandbox' } });
    await expect(getTenantQboEnvironmentSetting(knexStub, TENANT)).resolves.toBe('sandbox');
  });

  it('keeps sibling settings keys when writing', async () => {
    tenantSettingsRow.current = {
      settings: {
        qboAutomatedSalesTax: { realms: ['realm-1'] },
        accountingSync: { autoApply: true },
        quickbooksDesktop: { newProductItemType: 'INVENTORY' }
      }
    };

    await setTenantQboEnvironmentSetting(knexStub, TENANT, 'production');

    expect(tenantSettingsRow.current?.settings).toEqual({
      qboAutomatedSalesTax: { realms: ['realm-1'] },
      accountingSync: { autoApply: true },
      quickbooksDesktop: { newProductItemType: 'INVENTORY' },
      qbo: { environment: 'production' }
    });
  });

  it('keeps unrelated keys inside the qbo subtree when flipping the environment', async () => {
    tenantSettingsRow.current = { settings: { qbo: { environment: 'production', somethingElse: 1 } } };

    await setTenantQboEnvironmentSetting(knexStub, TENANT, 'sandbox');

    expect(tenantSettingsRow.current?.settings.qbo).toEqual({ environment: 'sandbox', somethingElse: 1 });
  });

  it('rejects an unsupported environment value', async () => {
    await expect(setTenantQboEnvironmentSetting(knexStub, TENANT, 'staging' as any)).rejects.toThrow(
      /sandbox.*production/
    );
    expect(tenantSettingsRow.current).toBeNull();
  });
});
