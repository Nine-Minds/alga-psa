import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { confirmEntraMappingsWithDb } from '@ee/lib/integrations/entra/mapping/confirmMappingsService';
import { provisionEntraClientForMapping } from '@ee/lib/integrations/entra/sync/clientProvisioningService';

describe('Entra deferred mapping decisions', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('T145/T146: persists decisions, then provisions a create-new client exactly once', async () => {
    const trx = await db.transaction();
    try {
      const discovery = tenantDb(trx, '__entra_deferred_mapping_discovery__');
      const tenantRow = await discovery
        .unscoped('tenants', 'Entra integration test selects one seeded tenant')
        .whereExists(
          discovery
            .unscoped('tax_rates', 'Entra integration test requires a seeded active tax rate')
            .select(trx.raw('1'))
            .whereRaw('tax_rates.tenant = tenants.tenant')
            .where({ is_active: true })
        )
        .select('tenant')
        .first();
      expect(tenantRow?.tenant).toBeTruthy();

      const tenant = String(tenantRow.tenant);
      const scoped = tenantDb(trx, tenant);
      const createNewManagedTenantId = randomUUID();
      const skippedManagedTenantId = randomUUID();
      const beforeClients = await scoped.table('clients').count('* as count').first();

      await scoped.table('entra_managed_tenants').insert([
        {
          tenant,
          managed_tenant_id: createNewManagedTenantId,
          entra_tenant_id: randomUUID(),
          display_name: `Create Later ${randomUUID()}`,
          primary_domain: `create-${randomUUID()}.example.test`,
          source_user_count: 2,
        },
        {
          tenant,
          managed_tenant_id: skippedManagedTenantId,
          entra_tenant_id: randomUUID(),
          display_name: `Skip ${randomUUID()}`,
          primary_domain: `skip-${randomUUID()}.example.test`,
          source_user_count: 3,
        },
      ]);

      const result = await confirmEntraMappingsWithDb(trx, {
        tenant,
        userId: randomUUID(),
        mappings: [
          {
            managedTenantId: createNewManagedTenantId,
            mappingState: 'create_new',
          },
          {
            managedTenantId: skippedManagedTenantId,
            mappingState: 'skip_for_now',
          },
        ],
      });

      expect(result).toEqual({ confirmedMappings: 2 });
      const decisions = await scoped.table('entra_client_tenant_mappings')
        .whereIn('managed_tenant_id', [createNewManagedTenantId, skippedManagedTenantId])
        .where({ is_active: true })
        .orderBy('mapping_state')
        .select('managed_tenant_id', 'client_id', 'mapping_state');
      expect(decisions).toEqual([
        expect.objectContaining({
          managed_tenant_id: createNewManagedTenantId,
          client_id: null,
          mapping_state: 'create_new',
        }),
        expect.objectContaining({
          managed_tenant_id: skippedManagedTenantId,
          client_id: null,
          mapping_state: 'skip_for_now',
        }),
      ]);

      const afterClients = await scoped.table('clients').count('* as count').first();
      expect(Number(afterClients?.count)).toBe(Number(beforeClients?.count));

      const firstProvision = await provisionEntraClientForMapping(trx, {
        tenantId: tenant,
        managedTenantId: createNewManagedTenantId,
      });
      const retriedProvision = await provisionEntraClientForMapping(trx, {
        tenantId: tenant,
        managedTenantId: createNewManagedTenantId,
      });

      expect(firstProvision.created).toBe(true);
      expect(retriedProvision).toMatchObject({
        created: false,
        client: { client_id: firstProvision.client.client_id },
      });
      const provisionedMapping = await scoped.table('entra_client_tenant_mappings')
        .where({ managed_tenant_id: createNewManagedTenantId, is_active: true })
        .first('mapping_state', 'client_id');
      expect(provisionedMapping).toMatchObject({
        mapping_state: 'mapped',
        client_id: firstProvision.client.client_id,
      });
      const afterProvisionClients = await scoped.table('clients').count('* as count').first();
      expect(Number(afterProvisionClients?.count)).toBe(Number(beforeClients?.count) + 1);

      await expect(confirmEntraMappingsWithDb(trx, {
        tenant,
        userId: randomUUID(),
        mappings: [{
          managedTenantId: createNewManagedTenantId,
          mappingState: 'mapped',
          clientId: null,
        }],
      })).rejects.toThrow('requires a client ID');
    } finally {
      await trx.rollback();
    }
  });
});
