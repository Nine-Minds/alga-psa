import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ getAdminConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }) },
}));
vi.mock('@temporalio/client', () => ({ Client: vi.fn(), Connection: vi.fn() }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: harness.getAdminConnection, refreshAdminConnection: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: harness.tenantDb,
  getTenantTableScope: () => ({ scope: 'tenant' }),
  retryOnReadOnly: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({ TagModel: {} }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../../db/tenant-operations.js', () => ({ insertStripeSubscriptionForTenant: vi.fn() }));
vi.mock('../../services/stripe-service.js', () => ({ updateSubscriptionMetadata: vi.fn() }));
vi.mock('../tenant-email-ingestion-activities.js', () => ({}));
vi.mock('../tenant-suspension-activities.js', () => ({}));

import { deleteTenantData } from '../tenant-deletion-activities.js';

describe('tenant deletion with external links', () => {
  it('explicitly deletes external links and custom systems before their parents, preserving other tenants', async () => {
    const target = 'tenant-to-delete';
    const survivor = 'another-tenant';
    const rows = new Map(['tenants', 'tickets', 'users', 'external_entity_links', 'tenant_external_systems']
      .map(table => [table, [{ tenant: target }, { tenant: survivor }]]));
    const deletedTables: string[] = [];
    const query = (table: string, tenant?: string) => {
      let counting = false;
      let managementLookup = false;
      const matching = () => (rows.get(table) ?? []).filter(row => row.tenant === tenant);
      const builder = {
        where: () => { managementLookup = true; return builder; },
        whereNot: () => builder,
        whereNotNull: () => builder,
        update: async () => 0,
        count: () => { counting = true; return builder; },
        first: async () => managementLookup ? undefined : counting ? { count: matching().length } : matching()[0],
        delete: async () => {
          const count = matching().length;
          if (count > 0) {
            deletedTables.push(table);
            rows.set(table, (rows.get(table) ?? []).filter(row => row.tenant !== tenant));
          }
          return count;
        },
      };
      return builder;
    };
    harness.tenantDb.mockImplementation((_db, tenant) => ({
      table: (table: string) => query(table, tenant),
      unscoped: (table: string) => query(table),
    }));
    harness.getAdminConnection.mockResolvedValue({
      raw: async (_sql: string, [table]: string[]) => ({
        rows: rows.has(table) ? [{ column_name: 'tenant' }] : [],
      }),
    });

    const result = await deleteTenantData(target, 'deletion-id');

    expect(result).toMatchObject({ success: true, deletedRecords: 5, tablesAffected: 5 });
    for (const table of ['external_entity_links', 'tenant_external_systems']) {
      expect(deletedTables).toContain(table);
      expect(rows.get(table)).toEqual([{ tenant: survivor }]);
      expect(deletedTables.indexOf(table)).toBeLessThan(deletedTables.indexOf('tenants'));
    }
    for (const parent of ['tickets', 'users']) {
      expect(deletedTables.indexOf('external_entity_links')).toBeLessThan(deletedTables.indexOf(parent));
    }
    for (const remaining of rows.values()) {
      expect(remaining).toEqual([{ tenant: survivor }]);
    }
  });
});
