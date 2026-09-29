import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Authorization boundary for the export-scoped connection action.
 *
 * The manual-export dialog needs connection choices but its operators hold
 * `exports_execute`, not necessarily `catalog_read`. This drives the real
 * action and real provider resolver (only the permission check and the stored
 * connection loaders are faked) to prove:
 *   - `exports_execute` alone is sufficient,
 *   - `catalog_read` alone is not,
 *   - no capability is denied.
 */

const permissionState = vi.hoisted(() => ({
  granted: new Set<string>(),
  failXero: false,
  xeroReads: 0,
  failQbo: false,
  qboReads: 0,
  failSettings: false,
  failSecondSettings: false,
  settingsReads: 0,
  defaultRealm: null as string | null,
  xero: {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' }
  } as Record<string, { connectionId: string; xeroTenantId: string; tenantName: string }>,
  qbo: { 'qbo-realm-a': { realmId: 'qbo-realm-a' } } as Record<string, { realmId: string }>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action({ user_id: 'u1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(
    async (_user: unknown, resource: string, action: string) =>
      permissionState.granted.has(`${resource}:${action}`)
  )
}));

function settingsBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.first = async () => {
    permissionState.settingsReads++;
    if (permissionState.failSettings || (permissionState.failSecondSettings && permissionState.settingsReads === 2)) {
      throw new Error('Settings temporarily unavailable');
    }
    return { settings: { accountingSync: { defaultRealm: permissionState.defaultRealm } } };
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: vi.fn(() => ({ table: () => settingsBuilder() }))
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: async () => {
    permissionState.qboReads++;
    if (permissionState.failQbo) throw new Error('Credential store temporarily unavailable');
    return permissionState.qbo;
  },
  getDefaultQboRealmId: async () => 'qbo-realm-a'
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => {
    permissionState.xeroReads++;
    if (permissionState.failXero) {
      throw new Error('Credential store temporarily unavailable');
    }
    return permissionState.xero;
  },
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-a' })
}));

import { getAccountingExportConnections } from '../../src/actions/accountingExportActions';

beforeEach(() => {
  permissionState.granted = new Set();
  permissionState.failXero = false;
  permissionState.xeroReads = 0;
  permissionState.failQbo = false;
  permissionState.qboReads = 0;
  permissionState.failSettings = false;
  permissionState.failSecondSettings = false;
  permissionState.settingsReads = 0;
  permissionState.defaultRealm = null;
  permissionState.xero = {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' }
  };
  permissionState.qbo = { 'qbo-realm-a': { realmId: 'qbo-realm-a' } };
});

describe('getAccountingExportConnections authorization', () => {
  it('allows an exports_execute operator without catalog_read', async () => {
    permissionState.granted = new Set(['accounting_integrations:exports_execute']);

    const view = await getAccountingExportConnections('xero');

    expect(view).toMatchObject({
      adapterType: 'xero',
      connected: true,
      issue: null,
      organisationName: 'Org A',
      realms: [{ realmId: 'conn-a', isDefault: true }]
    });
    expect(view).not.toHaveProperty('permissionError');
  });

  it('denies catalog_read-only users because the export surface requires exports_execute', async () => {
    permissionState.granted = new Set(['accounting_integrations:catalog_read']);

    const result = await getAccountingExportConnections('quickbooks_online');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
  });

  it('denies users with no accounting capability', async () => {
    const result = await getAccountingExportConnections('xero');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
  });
});

describe('getAccountingExportConnections credential-store failures', () => {
  it('propagates a selected-provider store outage so the dialog can show Retry', async () => {
    permissionState.granted = new Set(['accounting_integrations:exports_execute']);
    permissionState.failXero = true;

    await expect(getAccountingExportConnections('xero')).rejects.toThrow(
      'Credential store temporarily unavailable'
    );
  });

  it('propagates a QBO store outage instead of reporting no connections', async () => {
    permissionState.granted = new Set(['accounting_integrations:exports_execute']);
    permissionState.failQbo = true;

    await expect(getAccountingExportConnections('quickbooks_online')).rejects.toThrow(
      'Credential store temporarily unavailable'
    );
  });

  it.each(['xero', 'quickbooks_online'] as const)('propagates a settings failure for %s instead of choosing another company', async (provider) => {
    permissionState.granted.add('accounting_integrations:exports_execute');
    permissionState.failSettings = true;
    await expect(getAccountingExportConnections(provider)).rejects.toThrow('Settings temporarily unavailable');
  });
});

describe('getAccountingExportConnections consistent selection', () => {
  beforeEach(() => {
    permissionState.granted.add('accounting_integrations:exports_execute');
    permissionState.xero['conn-b'] = { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' };
    permissionState.qbo['qbo-realm-b'] = { realmId: 'qbo-realm-b' };
  });

  it.each([
    [null, 'conn-a'],
    ['disconnected', 'conn-a'],
    ['qbo-realm-b', 'conn-a'],
    ['conn-b', 'conn-b'],
    ['org-b', 'conn-b'],
  ])('resolves Xero default %s from one settings/store read', async (defaultRealm, expectedRealm) => {
    permissionState.defaultRealm = defaultRealm;
    permissionState.failQbo = true;
    const view = await getAccountingExportConnections('xero');
    expect(view).toMatchObject({ connected: true, issue: null });
    expect('realms' in view && view.realms.filter(r => r.isDefault)).toEqual([
      { realmId: expectedRealm, isDefault: true }
    ]);
    expect(permissionState.settingsReads).toBe(1);
    expect(permissionState.xeroReads).toBe(1);
    expect(permissionState.qboReads).toBe(0);
  });

  it('never replaces a known saved B with A through a redundant settings read', async () => {
    permissionState.defaultRealm = 'conn-b';
    permissionState.failSecondSettings = true;
    const view = await getAccountingExportConnections('xero');
    expect(view).toMatchObject({ connected: true, realms: [
      { realmId: 'conn-a', isDefault: false }, { realmId: 'conn-b', isDefault: true }
    ] });
    expect(permissionState.settingsReads).toBe(1);
    expect(permissionState.xeroReads).toBe(1);
  });

  it('keeps an ambiguous historical organisation unset in the same snapshot as the options', async () => {
    permissionState.defaultRealm = 'org-a';
    permissionState.xero['conn-b'].xeroTenantId = 'org-a';
    const view = await getAccountingExportConnections('xero');
    expect(view).toMatchObject({ connected: false, issue: 'ambiguous', realms: [
      { realmId: 'conn-a', isDefault: false }, { realmId: 'conn-b', isDefault: false }
    ] });
    expect(permissionState.settingsReads).toBe(1);
    expect(permissionState.xeroReads).toBe(1);
  });

  it.each([
    [null, 'qbo-realm-a'],
    ['disconnected', 'qbo-realm-a'],
    ['conn-b', 'qbo-realm-a'],
    ['qbo-realm-b', 'qbo-realm-b'],
  ])('resolves QBO default %s without consulting Xero', async (defaultRealm, expectedRealm) => {
    permissionState.defaultRealm = defaultRealm;
    permissionState.failXero = true;
    const view = await getAccountingExportConnections('quickbooks_online');
    expect(view).toMatchObject({ connected: true, issue: null });
    expect('realms' in view && view.realms.filter(r => r.isDefault)).toEqual([
      { realmId: expectedRealm, isDefault: true }
    ]);
    expect(permissionState.settingsReads).toBe(1);
    expect(permissionState.qboReads).toBe(1);
    expect(permissionState.xeroReads).toBe(0);
  });

  it.each(['xero', 'quickbooks_online'] as const)('distinguishes an empty %s store from a read failure', async (provider) => {
    permissionState.xero = {};
    permissionState.qbo = {};
    await expect(getAccountingExportConnections(provider)).resolves.toMatchObject({
      connected: false, issue: 'none_connected', realms: []
    });
  });
});
