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

const permissionState = vi.hoisted(() => ({ granted: new Set<string>() }));

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
  builder.first = async () => ({ settings: { accountingSync: { defaultRealm: null } } });
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: vi.fn(() => ({ table: () => settingsBuilder() }))
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: async () => ({ 'qbo-realm-a': { realmId: 'qbo-realm-a' } }),
  getDefaultQboRealmId: async () => 'qbo-realm-a'
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => ({
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' }
  }),
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-a' })
}));

import { getAccountingExportConnections } from '../../src/actions/accountingExportActions';

beforeEach(() => {
  permissionState.granted = new Set();
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
