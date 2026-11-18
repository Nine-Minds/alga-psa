import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      }
    };
    return builder;
  };
  return { tenantDb: () => ({ table: () => makeBuilder() }) };
});

import {
  getXeroAssignedNumberingRealms,
  isXeroAssignedNumberingEnabled,
  setXeroAssignedNumbering
} from './xeroInvoiceNumberingSettings';

const TENANT = 'tenant-xero-numbering';

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

describe('xeroInvoiceNumberingSettings', () => {
  beforeEach(() => {
    tenantSettingsRow.current = null;
  });

  it('is off when there is no settings row', async () => {
    await expect(getXeroAssignedNumberingRealms(knexStub, TENANT)).resolves.toEqual([]);
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, 'realm-1')).resolves.toBe(false);
  });

  it.each([
    ['missing key', { accountingSync: {} }],
    ['string value', { xeroInvoiceNumbering: 'on' }],
    ['non-array realms', { xeroInvoiceNumbering: { xeroAssignedRealms: 'realm-1' } }],
    ['null', { xeroInvoiceNumbering: null }]
  ])('normalises %s to off', async (_label, settings) => {
    tenantSettingsRow.current = { settings };
    await expect(getXeroAssignedNumberingRealms(knexStub, TENANT)).resolves.toEqual([]);
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, 'realm-1')).resolves.toBe(false);
  });

  it('drops non-string and empty realm entries', async () => {
    tenantSettingsRow.current = {
      settings: { xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1', 7, '', null] } }
    };
    await expect(getXeroAssignedNumberingRealms(knexStub, TENANT)).resolves.toEqual(['realm-1']);
  });

  it('is false for an empty realm id and for an unlisted realm', async () => {
    tenantSettingsRow.current = { settings: { xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1'] } } };
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, '')).resolves.toBe(false);
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, null)).resolves.toBe(false);
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, 'realm-2')).resolves.toBe(false);
    await expect(isXeroAssignedNumberingEnabled(knexStub, TENANT, 'realm-1')).resolves.toBe(true);
  });

  it('writes into a fresh row', async () => {
    await expect(setXeroAssignedNumbering(knexStub, TENANT, 'realm-1', true)).resolves.toEqual(['realm-1']);
    expect(tenantSettingsRow.current?.settings).toEqual({
      xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1'] }
    });
  });

  it('preserves other settings keys, including accountingSync, and other realms', async () => {
    tenantSettingsRow.current = {
      settings: {
        accountingSync: { autoSyncEnabled: true, defaultRealm: 'realm-9' },
        qbo: { environment: 'sandbox' },
        xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1'] }
      }
    };
    await expect(setXeroAssignedNumbering(knexStub, TENANT, 'realm-2', true)).resolves.toEqual(['realm-1', 'realm-2']);
    expect(tenantSettingsRow.current?.settings).toEqual({
      accountingSync: { autoSyncEnabled: true, defaultRealm: 'realm-9' },
      qbo: { environment: 'sandbox' },
      xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1', 'realm-2'] }
    });
  });

  it('removes a realm and does not duplicate on repeated enable', async () => {
    tenantSettingsRow.current = { settings: { xeroInvoiceNumbering: { xeroAssignedRealms: ['realm-1'] } } };
    await setXeroAssignedNumbering(knexStub, TENANT, 'realm-1', true);
    expect(tenantSettingsRow.current?.settings.xeroInvoiceNumbering.xeroAssignedRealms).toEqual(['realm-1']);
    await expect(setXeroAssignedNumbering(knexStub, TENANT, 'realm-1', false)).resolves.toEqual([]);
  });

  it('rejects an empty realm id', async () => {
    await expect(setXeroAssignedNumbering(knexStub, TENANT, '', true)).rejects.toThrow();
  });
});
