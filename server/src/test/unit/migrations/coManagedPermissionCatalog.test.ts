import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CO_MANAGED_PERMISSIONS } from '../../../../../packages/licensing/src/lib/co-managed-admission-permissions';
import { PERMISSION_RESOURCE_CAPABILITIES } from '../../../../../packages/auth/src/lib/permissionCapabilities';
import {
  CO_MANAGED_CAPABILITY,
  CO_MANAGED_PERMISSION_ACTIONS,
  CO_MANAGED_PERMISSION_RESOURCE,
} from '../../../../../packages/co-managed/src/permissionsCapability';

const require = createRequire(import.meta.url);
const migrations = path.resolve(__dirname, '../../../../migrations');
const catalog = require(path.join(migrations, 'utils/permissions/catalog.cjs'));
const roleGrants = require(path.join(migrations, 'utils/permissions/roleGrants.cjs'));
const { collectCatalogErrors } = require(path.join(migrations, 'utils/permissions/catalogValidation.cjs'));

const isCoManagement = (p: any) => p.resource === 'co_management';
const keys = (list: any[]) => list.filter(isCoManagement).map(p => `${p.resource}:${p.action}`).sort();

describe('co-managed permission catalog entries', () => {
  it('are withheld from psa unless the capability is served (no global backfill)', () => {
    expect(keys(catalog.getProductPermissions('psa'))).toEqual([]);
    expect(keys(catalog.getProductPermissions('algadesk'))).toEqual([]);
  });

  it('are present for the co_managed product and for psa with the capability', () => {
    const expected = ['co_management:manage', 'co_management:read'];
    expect(keys(catalog.getProductPermissions('co_managed'))).toEqual(expected);
    expect(keys(catalog.getProductPermissions('psa', { capabilities: ['co-managed'] }))).toEqual(expected);
  });

  it('are msp-only and tagged with the co-managed capability', () => {
    const entries = catalog.getProductPermissions('co_managed').filter(isCoManagement);
    for (const entry of entries) {
      expect(entry.msp).toBe(true);
      expect(entry.client).toBe(false);
      expect(entry.capabilities).toEqual(['co-managed']);
    }
  });

  it('pass catalog validation, and reject malformed capabilities', () => {
    expect(collectCatalogErrors()).toEqual([]);
    const bad = collectCatalogErrors([{ ...catalog.PERMISSIONS?.[0], capabilities: [] }]);
    expect(bad.length).toBeGreaterThan(0);
  });

  it('compile role grants for co_managed but not for psa', () => {
    const grants = (product: string) => JSON.stringify([...roleGrants.compileRoleGrants(product).values()]);
    expect(grants('co_managed')).toContain('co_management');
    expect(grants('psa')).not.toContain('co_management');
  });

  it('agree with the licensing, auth and co-managed constants', () => {
    const catalogKeys = keys(catalog.getProductPermissions('co_managed'));
    expect(CO_MANAGED_PERMISSIONS.map(p => `${p.resource}:${p.action}`).sort()).toEqual(catalogKeys);
    expect(PERMISSION_RESOURCE_CAPABILITIES[CO_MANAGED_PERMISSION_RESOURCE]).toBe(CO_MANAGED_CAPABILITY);
    expect([...CO_MANAGED_PERMISSION_ACTIONS].sort()).toEqual(CO_MANAGED_PERMISSIONS.map(p => p.action).sort());
  });
});

describe('co_managed system_settings grants (customer-owned provider setup, L9)', () => {
  const settings = (product: string) => catalog.getProductPermissions(product)
    .filter((p: any) => p.resource === 'system_settings')
    .map((p: any) => `${p.action}`).sort();

  it('exposes only read and update to co_managed, and leaves psa/algadesk unchanged', () => {
    expect(settings('co_managed')).toEqual(['read', 'update']);
    expect(settings('psa')).toEqual(['create', 'delete', 'read', 'update']);
    expect(settings('algadesk')).toEqual(['read', 'update']);
  });

  it('grants them to the co_managed msp:Admin role only', () => {
    const { msp } = roleGrants.compileLegacyRoleGrants('co_managed');
    expect(msp.Admin).toBe('ALL_MSP');
    for (const [role, list] of Object.entries(msp) as Array<[string, string[] | string]>) {
      if (role === 'Admin') continue;
      expect(JSON.stringify(list)).not.toContain('system_settings');
    }
  });
});
