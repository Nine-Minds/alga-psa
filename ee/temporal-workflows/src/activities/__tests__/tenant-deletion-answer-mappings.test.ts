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

describe('tenant deletion dependency ordering', () => {
  it.each([
    {
      scenario: 'questionnaire answer mappings',
      dependencies: [
        ['service_request_submission_application_results', 'service_request_submission_applications'],
        ['service_request_submission_applications', 'service_request_answer_mapping_versions'],
        ['service_request_submission_applications', 'service_request_submissions'],
        ['service_request_answer_mapping_versions', 'service_request_answer_mappings'],
        ['service_request_answer_mappings', 'service_request_definitions'],
        ['service_request_submissions', 'service_request_definition_versions'],
        ['service_request_definition_versions', 'service_request_definitions'],
        ['service_request_definitions', 'tenants'],
      ],
    },
    {
      scenario: 'telephony call history and intents',
      dependencies: [
        ['telephony_call_artifacts', 'telephony_call_records'],
        ['telephony_call_records', 'telephony_providers'],
        ['telephony_providers', 'tenants'],
        // Intents refer to operational records by convention, but are still tenant-owned.
        ['telephony_call_intents', 'tenants'],
      ],
    },
  ])('deletes $scenario before its parents and preserves another tenant', async ({ dependencies }) => {
    const target = 'tenant-to-delete';
    const survivor = 'another-tenant';
    // Require explicit child cleanup so every row is included in the activity's audit count.
    const tables = [...new Set(dependencies.flat())];
    const rows = new Map(tables
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
            for (const [child, parent] of dependencies) {
              if (parent === table && rows.get(child)?.some(row => row.tenant === tenant)) {
                throw new Error(`${child} must be deleted before ${parent}`);
              }
            }
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
    for (const remaining of rows.values()) {
      expect(remaining).toEqual([{ tenant: survivor }]);
    }
  });
});
