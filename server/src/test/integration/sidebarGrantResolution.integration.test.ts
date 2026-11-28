/**
 * Sidebar grant resolution, before and after PR #4393, for every default MSP role.
 *
 * Before: the sidebar listed the caller's grants with getCurrentUserPermissions(), which first checks
 * `user:read` and returns [] for any role without it. After: it asks the hasPermission engine about
 * every `requiredPermission` key in the menu (resolveCurrentUserGrants). Both read the same
 * role_permissions rows, so the difference is exactly the `user:read` precondition.
 *
 * This suite seeds each product's default roles from the permission catalog on real Postgres, resolves
 * grants both ways for a user holding only that role, runs both through the real menu filter, and pins
 * which menu entries change visibility. RBAC is not mocked; only the session seam is.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const seam = vi.hoisted(() => ({ db: null as any, user: null as any }));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: seam.db, tenant: seam.user?.tenant })) };
});
// Both resolvers wrap themselves in withAuth/withOptionalAuth; point the session at the per-test user.
vi.mock('../../../../packages/auth/src/lib/withAuth', async () => {
  const actual = await vi.importActual<any>('../../../../packages/auth/src/lib/withAuth');
  const { runWithTenant: run } = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  const wrap = (action: any) => (...args: any[]) => run(seam.user.tenant, () => action(seam.user, { tenant: seam.user.tenant }, ...args));
  return { ...actual, withAuth: wrap, withOptionalAuth: wrap };
});
vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth');
  const { runWithTenant: run } = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  const wrap = (action: any) => (...args: any[]) => run(seam.user.tenant, () => action(seam.user, { tenant: seam.user.tenant }, ...args));
  return { ...actual, withAuth: wrap, withOptionalAuth: wrap };
});
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: false }) }));

import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions/userQueryActions';
import { resolveCurrentUserGrants } from '../../lib/auth/currentUserGrants';
import {
  collectRequiredPermissionKeys,
  filterNavigationSectionsByPermission,
} from '../../components/layout/SidebarWithFeatureFlags';
import { billingNavigationSections, navigationSections, type MenuItem, type NavigationSection } from '../../config/menuConfig';
import { CO_MANAGED_MENU_GROUP } from '../../config/coManagedMenu';

const nodeRequire = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { DEFAULT_ROLES } = nodeRequire(path.join(permissionsDir, 'roleGrants.cjs'));
const { syncPermissionCatalog } = nodeRequire(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));

/** Every menu tree the sidebar resolves permissions for (the co-managed group only renders when that capability is served). */
const SECTIONS: NavigationSection[] = [...navigationSections, ...billingNavigationSections, CO_MANAGED_MENU_GROUP];
/** Workflows > Dead Letter is gated by name on workflow:admin, outside requiredPermission. */
const DEAD_LETTER = 'Workflows > Dead Letter (workflow:admin)';

function visibleEntries(grants: readonly string[]): Set<string> {
  const names = new Set<string>();
  const visit = (items: readonly MenuItem[], parent?: string) => items.forEach((item) => {
    names.add(parent ? `${parent} > ${item.name}` : item.name);
    if (item.subItems) visit(item.subItems, item.name);
  });
  filterNavigationSectionsByPermission(SECTIONS, grants).forEach((section) => visit(section.items, section.title || undefined));
  if (grants.includes('workflow:admin')) names.add(DEAD_LETTER);
  return names;
}

type Product = 'psa' | 'co_managed' | 'algadesk';
interface RoleDiff { gained: string[]; lost: string[]; holdsUserRead: boolean }

let db: Knex;
const tenants: string[] = [];
const results: Record<string, RoleDiff> = {};

async function resolveForProduct(product: Product) {
  const tenant = uuidv4();
  tenants.push(tenant);
  const t = (table: string) => tenantDb(db, tenant).table(table);
  await tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows')
    .insert({ tenant, client_name: `Sidebar ${product} ${tenant.slice(0, 8)}`, email: `sidebar-${tenant.slice(0, 8)}@example.com`, product_code: product });
  // Legacy roles (PSA Manager) are included: older tenants and dev databases still have them and the catalog grants them.
  const mspRoles = DEFAULT_ROLES[product].filter((role: any) => role.msp);
  await t('roles').insert(DEFAULT_ROLES[product].map((role: any) => ({
    tenant, role_name: role.roleName, description: role.key, msp: role.msp, client: role.client,
  })));
  await syncPermissionCatalog(db, tenant, product);

  // Custom (non-default) roles that hold a menu permission but not user:read: these are what the finding
  // calls out. Only seeded for PSA, where those permissions exist.
  const customRoles: Array<{ roleName: string; grants: string[] }> = product === 'psa'
    ? [{ roleName: 'Custom: exports_execute only', grants: ['accounting_integrations:exports_execute'] }]
    : [];
  for (const custom of customRoles) {
    const roleId = uuidv4();
    await t('roles').insert({ tenant, role_id: roleId, role_name: custom.roleName, msp: true, client: false });
    for (const key of custom.grants) {
      const [resource, action] = key.split(':');
      const { permission_id } = await t('permissions').where({ resource, action, msp: true }).first('permission_id');
      await t('role_permissions').insert({ tenant, role_id: roleId, permission_id });
    }
  }

  const keys = collectRequiredPermissionKeys(SECTIONS, ['workflow:admin']);
  for (const role of [...mspRoles, ...customRoles]) {
    const userId = uuidv4();
    await t('users').insert({ tenant, user_id: userId, username: `u-${userId.slice(0, 8)}`, hashed_password: 'x', email: `u-${userId.slice(0, 8)}@example.com`, user_type: 'internal' });
    const { role_id } = await t('roles').where({ role_name: role.roleName, msp: true, client: false }).first('role_id');
    await t('user_roles').insert({ tenant, user_id: userId, role_id });
    seam.user = { user_id: userId, tenant, user_type: 'internal', roles: [] };

    const before = await getCurrentUserPermissions();
    const after = await resolveCurrentUserGrants(keys);
    const userRead = await runWithTenant(tenant, () => resolveCurrentUserGrants(['user:read']));
    const [vb, va] = [visibleEntries(before), visibleEntries(after)];
    results[`${product}:${role.roleName}`] = {
      gained: [...va].filter((name) => !vb.has(name)).sort(),
      lost: [...vb].filter((name) => !va.has(name)).sort(),
      holdsUserRead: userRead.length === 1,
    };
  }
}

describe('sidebar grant resolution: main (getCurrentUserPermissions) vs PR #4393 (resolveCurrentUserGrants)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    seam.db = db;
    for (const product of ['psa', 'co_managed', 'algadesk'] as const) await resolveForProduct(product);
    // The per-role table, for reviewers: SIDEBAR_DIFF_OUT=<file> writes it as JSON.
    if (process.env.SIDEBAR_DIFF_OUT) writeFileSync(process.env.SIDEBAR_DIFF_OUT, `${JSON.stringify(results, null, 2)}\n`);
  }, 120_000);

  afterAll(async () => {
    for (const tenant of tenants) {
      for (const table of ['user_roles', 'role_permissions', 'users', 'roles', 'permissions']) {
        await tenantDb(db, tenant).table(table).delete().catch(() => undefined);
      }
      await tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'cleanup').where({ tenant }).delete().catch(() => undefined);
    }
    await db?.destroy();
  });

  // Compared on the PR's menu, so the new 'Submit on behalf of…' row appears here only where the old
  // resolver would have hidden it too (no user:read). For every role it is a new row; see the guide.
  const TECHNICIAN_GAINS = [
    'Service Requests > Submit on behalf of…',
    'Tickets > Canned Responses',
    'Tickets > Recurring Tickets',
    'Tickets > Ticket Templates',
  ];

  it('PSA Technician (the only default PSA role without user:read) gains the ticket entries it holds; nothing is lost', () => {
    expect(results['psa:Technician']).toEqual({ gained: TECHNICIAN_GAINS, lost: [], holdsUserRead: false });
  });

  it('co-managed Technician (no user:read) gains the same entries; nothing is lost', () => {
    expect(results['co_managed:Technician']).toEqual({ gained: TECHNICIAN_GAINS, lost: [], holdsUserRead: false });
  });

  it('every other default MSP role holds user:read and sees no visibility change', () => {
    const others = Object.entries(results).filter(([key]) => !key.endsWith(':Technician') && !key.includes(':Custom'));
    expect(others.map(([key]) => key).sort()).toEqual([
      'algadesk:Admin', 'algadesk:Agent',
      'co_managed:Admin', 'co_managed:Dispatcher', 'co_managed:Project Manager',
      'psa:Admin', 'psa:Dispatcher', 'psa:Finance', 'psa:Manager', 'psa:Project Manager',
    ]);
    for (const [key, diff] of others) {
      expect(diff, key).toEqual({ gained: [], lost: [], holdsUserRead: true });
    }
  });

  it('a custom role holding accounting_integrations:exports_execute without user:read now sees Accounting Exports', () => {
    expect(results['psa:Custom: exports_execute only']).toEqual({
      gained: ['Tracking & Reports > Accounting Exports'], lost: [], holdsUserRead: false,
    });
  });

  it('Accounting Exports, Dead Letter and the co-managed group change for no default role', () => {
    for (const [key, diff] of Object.entries(results).filter(([k]) => !k.includes(':Custom'))) {
      for (const name of [...diff.gained, ...diff.lost]) {
        expect(name, key).not.toMatch(/Accounting Exports|Dead Letter|Co-managed/i);
      }
    }
  });
});
