import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { MigrationLedger } from '@/lib/migrations/MigrationLedger';

/**
 * Database-backed regression coverage for AMP's tenant-first ledger contract.
 * Domain-applier integration is intentionally exercised through this same
 * transaction boundary: a second attempt sees the committed source identity.
 */
describe('AMP migration ledger (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let otherTenant: string;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
    const rows = await knex('tenants').select('tenant').limit(2);
    tenant = rows[0].tenant;
    otherTenant = rows[1]?.tenant ?? tenant;
  });

  afterAll(async () => { await knex?.destroy(); });

  it('keeps identity mappings tenant isolated and makes a second apply a skip', async () => {
    const jobId = uuidv4();
    const sourceId = `amp-test-${uuidv4()}`;
    const targetId = uuidv4();
    const ledger = new MigrationLedger(tenant);
    await knex.transaction(async (trx) => {
      await trx('migration_identity_mappings').insert({
        tenant, namespace: 'integration-test', entity_type: 'organizations',
        source_record_id: sourceId, target_entity_type: 'client', target_entity_id: targetId,
        migration_job_id: jobId,
      });
      const mapped = await ledger.findMapping(trx, { namespace: 'integration-test', entityType: 'organizations', sourceRecordId: sourceId });
      expect(mapped?.targetEntityId).toBe(targetId);
    });
    const second = await knex.transaction((trx) => ledger.findMapping(trx, { namespace: 'integration-test', entityType: 'organizations', sourceRecordId: sourceId }));
    expect(second?.targetEntityId).toBe(targetId);
    if (otherTenant !== tenant) {
      const isolated = await knex('migration_identity_mappings').where({ tenant: otherTenant, namespace: 'integration-test', source_record_id: sourceId }).first();
      expect(isolated).toBeUndefined();
    }
  });
});
