import { expect, vi } from 'vitest';

const harness = vi.hoisted(() => ({ getAdminConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }) },
}));
vi.mock('@temporalio/client', () => ({ Client: vi.fn(), Connection: vi.fn() }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: harness.getAdminConnection, refreshAdminConnection: vi.fn(),
}));
vi.mock('@alga-psa/db', async () => ({
  tenantDb: harness.tenantDb,
  getTenantTableScope: (await import('../../../../packages/db/src/lib/tenantTableMetadata')).getTenantTableScope,
  retryOnReadOnly: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({ TagModel: {} }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../db/tenant-operations.js', () => ({ insertStripeSubscriptionForTenant: vi.fn() }));
vi.mock('../services/stripe-service.js', () => ({ updateSubscriptionMetadata: vi.fn() }));
vi.mock('../activities/tenant-email-ingestion-activities.js', () => ({}));
vi.mock('../activities/tenant-suspension-activities.js', () => ({}));

import { deleteTenantData } from '../activities/tenant-deletion-activities.js';

/** Exercises the real deletion activity against tenant-isolated rows and restrictive FKs. */
export async function expectTenantDeletion(
  dependencies: string[][],
  tableData: Record<string, Record<string, unknown>> = {},
) {
  const target = 'tenant-to-delete';
  const survivor = 'another-tenant';
  const tables = [...new Set(dependencies.flat())];
  const seed = (table: string, tenant: string): Record<string, unknown> & { tenant: string } => ({
    ...tableData[table],
    tenant,
  });
  const rows = new Map(tables.map(table => [table, [seed(table, target), seed(table, survivor)]]));
  const deletedTables: string[] = [];
  const operations: { table: string; kind: string; data?: object }[] = [];
  const query = (table: string, tenant?: string) => {
    let counting = false;
    let managementLookup = false;
    let notNullColumn: string | undefined;
    const matching = () => (rows.get(table) ?? []).filter(row =>
      row.tenant === tenant && (!notNullColumn || row[notNullColumn] != null));
    const builder = {
      where: (criteria: unknown) => {
        if (criteria && typeof criteria === 'object' && 'tenant' in criteria) {
          tenant = String(criteria.tenant);
        } else {
          managementLookup = true;
        }
        return builder;
      },
      whereNot: () => builder,
      whereNotNull: (column: string) => { notNullColumn = column; return builder; },
      update: async (data: object) => {
        const selected = matching();
        if (selected.length) operations.push({ table, kind: 'update', data });
        for (const row of selected) Object.assign(row, data);
        return selected.length;
      },
      count: () => { counting = true; return builder; },
      first: async () => managementLookup ? undefined : counting ? { count: matching().length } : matching()[0],
      delete: async () => {
        const count = matching().length;
        if (count > 0) {
          for (const [child, parent] of dependencies) {
            if (parent === table && rows.get(child)?.some(row => row.tenant === tenant)) {
              throw new Error(`${child} must be deleted before ${parent}`);
            }
          }
          operations.push({ table, kind: 'delete' });
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

  expect(result).toMatchObject({ success: true, deletedRecords: tables.length, tablesAffected: tables.length });
  expect(deletedTables).toHaveLength(tables.length);
  for (const [child, parent] of dependencies) {
    expect(deletedTables).toContain(child);
    expect(deletedTables).toContain(parent);
    expect(deletedTables.indexOf(child)).toBeLessThan(deletedTables.indexOf(parent));
  }
  for (const [table, remaining] of rows) {
    expect(remaining).toEqual([seed(table, survivor)]);
  }
  return { operations };
}
