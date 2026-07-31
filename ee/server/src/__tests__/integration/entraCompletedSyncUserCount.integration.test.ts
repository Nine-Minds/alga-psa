import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { listConfirmedEntraMappingsWithDb } from '@ee/lib/integrations/entra/mapping/confirmedMappingsService';
import { projectCompletedSyncUserCount } from '@ee/lib/integrations/entra/sync/completedSyncUserCountService';

describe('Entra completed-sync user count projection', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('T141/T142: prefers a successful sync count, including zero, and preserves it across failed or dry runs', async () => {
    const trx = await db.transaction();
    try {
      const discovery = tenantDb(trx, '__entra_sync_count_discovery__');
      const tenantRow = await discovery
        .unscoped('tenants', 'Entra sync-count test selects one seeded tenant with a client')
        .whereExists(
          discovery
            .unscoped('clients', 'Entra sync-count test requires a seeded mapped client')
            .select(trx.raw('1'))
            .whereRaw('clients.tenant = tenants.tenant')
        )
        .select('tenant')
        .first();
      expect(tenantRow?.tenant).toBeTruthy();

      const tenant = String(tenantRow.tenant);
      const scoped = tenantDb(trx, tenant);
      const client = await scoped.table('clients').first(['client_id']);
      expect(client?.client_id).toBeTruthy();

      const managedTenantId = randomUUID();
      await scoped.table('entra_managed_tenants').insert({
        tenant,
        managed_tenant_id: managedTenantId,
        entra_tenant_id: randomUUID(),
        display_name: `Count Projection ${randomUUID()}`,
        primary_domain: `count-${randomUUID()}.example.test`,
        source_user_count: 7,
      });
      await scoped.table('entra_client_tenant_mappings').insert({
        tenant,
        mapping_id: randomUUID(),
        managed_tenant_id: managedTenantId,
        client_id: client.client_id,
        mapping_state: 'mapped',
        is_active: true,
      });

      const beforeSync = await listConfirmedEntraMappingsWithDb(trx, tenant);
      expect(beforeSync.find((mapping) => mapping.managedTenantId === managedTenantId)).toEqual(
        expect.objectContaining({
          managedTenantId,
          sourceUserCount: 7,
          userCount: 7,
          userCountSource: 'discovery',
        })
      );

      expect(await projectCompletedSyncUserCount(trx, {
        tenantId: tenant,
        managedTenantId,
        status: 'failed',
        eligibleUserCount: 99,
      })).toBe(false);
      expect(await projectCompletedSyncUserCount(trx, {
        tenantId: tenant,
        managedTenantId,
        status: 'completed',
        isDryRun: true,
        eligibleUserCount: 88,
      })).toBe(false);

      const afterIgnoredRuns = await scoped.table('entra_managed_tenants')
        .where({ managed_tenant_id: managedTenantId })
        .first(['last_successful_sync_user_count', 'last_successful_sync_at']);
      expect(afterIgnoredRuns).toMatchObject({
        last_successful_sync_user_count: null,
        last_successful_sync_at: null,
      });

      expect(await projectCompletedSyncUserCount(trx, {
        tenantId: tenant,
        managedTenantId,
        status: 'completed',
        eligibleUserCount: 0,
      })).toBe(true);

      const afterSync = await listConfirmedEntraMappingsWithDb(trx, tenant);
      expect(afterSync.find((mapping) => mapping.managedTenantId === managedTenantId)).toEqual(
        expect.objectContaining({
          managedTenantId,
          sourceUserCount: 7,
          userCount: 0,
          userCountSource: 'sync',
          userCountObservedAt: expect.any(String),
        })
      );
    } finally {
      await trx.rollback();
    }
  });
});
