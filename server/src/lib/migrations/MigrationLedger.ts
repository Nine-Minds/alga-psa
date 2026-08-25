import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';

export type MigrationApplyResult = { action: 'created' | 'skipped' | 'failed'; targetEntityType?: string; targetEntityId?: string; errors?: unknown[]; warnings?: unknown[] };

/** The only write boundary for record application: target mutation, outcome and identity are one transaction. */
export class MigrationLedger {
  constructor(private readonly db: Knex, private readonly tenant: string) {}

  async applyOnce(input: { jobId: string; stagedRecordId: string; namespace: string; entityType: string; sourceRecordId: string }, mutate: (trx: Knex.Transaction) => Promise<{ targetEntityType: string; targetEntityId: string }>): Promise<MigrationApplyResult> {
    return withTransaction(this.db, async trx => {
      const scoped = tenantDb(trx, this.tenant);
      const mapping = await scoped.table('migration_identity_mappings').where({ namespace: input.namespace, entity_type: input.entityType, source_record_id: input.sourceRecordId }).first();
      const prior = await scoped.table('migration_record_outcomes').where({ migration_staged_record_id: input.stagedRecordId }).orderBy('attempt', 'desc').first();
      const attempt = Number(prior?.attempt ?? 0) + 1;
      if (mapping) {
        await scoped.table('migration_record_outcomes').insert({ migration_job_id: input.jobId, migration_staged_record_id: input.stagedRecordId, attempt, action: 'skipped', target_entity_type: mapping.target_entity_type, target_entity_id: mapping.target_entity_id, errors: [], warnings: [{ code: 'ALREADY_APPLIED' }] });
        return { action: 'skipped', targetEntityType: mapping.target_entity_type, targetEntityId: mapping.target_entity_id };
      }
      const target = await mutate(trx);
      await scoped.table('migration_identity_mappings').insert({ namespace: input.namespace, entity_type: input.entityType, source_record_id: input.sourceRecordId, target_entity_type: target.targetEntityType, target_entity_id: target.targetEntityId });
      await scoped.table('migration_record_outcomes').insert({ migration_job_id: input.jobId, migration_staged_record_id: input.stagedRecordId, attempt, action: 'created', target_entity_type: target.targetEntityType, target_entity_id: target.targetEntityId, errors: [], warnings: [] });
      await scoped.table('migration_job_entities').where({ migration_job_id: input.jobId, entity_type: input.entityType }).increment('applied_count', 1);
      return { action: 'created', targetEntityType: target.targetEntityType, targetEntityId: target.targetEntityId };
    });
  }
}
