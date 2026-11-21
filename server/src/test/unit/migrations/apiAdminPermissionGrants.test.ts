import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../../migrations/utils/permissions');
const { ACTIVE_PERMISSIONS } = require(path.join(permissionsDir, 'catalog.cjs'));
const { ALL_MSP, compileLegacyRoleGrants } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const WEBHOOK_ACTIONS = [
  'analytics', 'bulk_update', 'create', 'delete', 'export', 'manage_security', 'manage_subscriptions',
  'read', 'retry', 'system_settings', 'test', 'trigger', 'update', 'verify',
];
const ADMIN_ONLY: Array<[string, string]> = [
  ['metadata', 'read'],
  ...['read', 'create', 'update', 'delete'].map((a): [string, string] => ['role', a]),
  ...WEBHOOK_ACTIONS.map((a): [string, string] => ['webhook', a]),
];

describe('API admin permissions (metadata, role, webhook)', () => {
  it('are declared msp-only with msp:Admin as the sole default grantee', () => {
    for (const [resource, action] of ADMIN_ONLY) {
      const entries = ACTIVE_PERMISSIONS.filter((p: any) => p.resource === resource && p.action === action);
      expect(entries, `${resource}:${action}`).toHaveLength(1);
      const [entry] = entries;
      expect(entry.msp).toBe(true);
      expect(entry.client).toBe(false);
      expect(entry.products).toEqual(expect.arrayContaining(['algadesk', 'psa']));
      expect(entry.description.length).toBeGreaterThan(15);
      for (const grantees of Object.values(entry.defaultGrants)) expect(grantees).toEqual(['msp:Admin']);
    }
    expect(ACTIVE_PERMISSIONS.filter((p: any) => p.resource === 'webhook').map((p: any) => p.action).sort())
      .toEqual(WEBHOOK_ACTIONS);
  });

  it('flow into the PSA and AlgaDesk Admin grants', () => {
    const psa = compileLegacyRoleGrants('psa');
    expect(psa.msp.Admin).toBe(ALL_MSP);
    const algadesk = compileLegacyRoleGrants('algadesk');
    const adminKeys = algadesk.msp.Admin === ALL_MSP
      ? ADMIN_ONLY.map(([r, a]) => `${r}:${a}:msp`)
      : algadesk.msp.Admin;
    for (const [resource, action] of ADMIN_ONLY) expect(adminKeys).toContain(`${resource}:${action}:msp`);
  });

  it('are held by no non-Admin msp role and no client role', () => {
    const adminKeys = new Set(ADMIN_ONLY.map(([r, a]) => `${r}:${a}`));
    for (const product of ['psa', 'algadesk', 'co_managed']) {
      const grants = compileLegacyRoleGrants(product);
      for (const scope of ['msp', 'client'] as const) {
        for (const [role, keys] of Object.entries<any>(grants[scope])) {
          if (scope === 'msp' && role === 'Admin') continue;
          const held = (keys as string[]).filter((k) => adminKeys.has(k.split(':').slice(0, 2).join(':')));
          expect(held, `${product} ${scope} ${role}`).toEqual([]);
        }
      }
    }
  });
});
