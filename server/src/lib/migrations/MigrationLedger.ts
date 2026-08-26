import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface IdentityKey {
  namespace: string;
  entityType: string;
  sourceRecordId: string;
}

export interface OutcomeInput {
  migrationJobId: string;
  migrationStagedRecordId: string;
  attempt: number;
  action: 'created' | 'skipped' | 'failed';
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  errors?: string[];
  warnings?: string[];
}

/**
 * The idempotency anchor and append-only outcome ledger.
 *
 * The retry contract: a target mutation, its outcome row, and its identity
 * mapping are always written in the SAME transaction. Callers pass that
 * transaction in; this class never opens one.
 */
export class MigrationLedger {
  constructor(private readonly tenant: string) {}

  /** The applied target for a source key, or null when never applied. */
  async findMapping(
    trx: Knex.Transaction,
    key: IdentityKey
  ): Promise<{ targetEntityType: string; targetEntityId: string } | null> {
    const db = tenantDb(trx, this.tenant);
    const row = await db
      .table('migration_identity_mappings')
      .where({
        namespace: key.namespace,
        entity_type: key.entityType,
        source_record_id: key.sourceRecordId,
      })
      .first();
    return row
      ? { targetEntityType: row.target_entity_type, targetEntityId: row.target_entity_id }
      : null;
  }

  /** Bulk lookup used by the planner's dry run (read-only, no transaction). */
  async findMappedSourceIds(
    knex: Knex,
    namespace: string,
    entityType: string,
    sourceRecordIds: string[]
  ): Promise<Set<string>> {
    if (sourceRecordIds.length === 0) {
      return new Set();
    }
    const db = tenantDb(knex, this.tenant);
    const rows = await db
      .table('migration_identity_mappings')
      .where({ namespace, entity_type: entityType })
      .whereIn('source_record_id', sourceRecordIds)
      .select('source_record_id');
    return new Set(rows.map((row: { source_record_id: string }) => row.source_record_id));
  }

  /** Record a creation: identity mapping + outcome, same transaction. */
  async recordCreation(
    trx: Knex.Transaction,
    key: IdentityKey,
    outcome: OutcomeInput & { migrationJobId: string; targetEntityType: string; targetEntityId: string }
  ): Promise<void> {
    const db = tenantDb(trx, this.tenant);
    await db.table('migration_identity_mappings').insert({
      tenant: this.tenant,
      namespace: key.namespace,
      entity_type: key.entityType,
      source_record_id: key.sourceRecordId,
      target_entity_type: outcome.targetEntityType,
      target_entity_id: outcome.targetEntityId,
      migration_job_id: outcome.migrationJobId,
    });
    await this.recordOutcome(trx, outcome);
  }

  /** Record a skip or failure outcome (no identity mapping). */
  async recordOutcome(trx: Knex.Transaction, outcome: OutcomeInput): Promise<void> {
    const db = tenantDb(trx, this.tenant);
    await db.table('migration_record_outcomes').insert({
      tenant: this.tenant,
      migration_job_id: outcome.migrationJobId,
      migration_staged_record_id: outcome.migrationStagedRecordId,
      attempt: outcome.attempt,
      action: outcome.action,
      target_entity_type: outcome.targetEntityType ?? null,
      target_entity_id: outcome.targetEntityId ?? null,
      errors: JSON.stringify(outcome.errors ?? []),
      warnings: JSON.stringify(outcome.warnings ?? []),
    });
  }

  /** Latest attempt number recorded for a job (0 when none). */
  async latestAttempt(knex: Knex, migrationJobId: string): Promise<number> {
    const db = tenantDb(knex, this.tenant);
    const row = await db
      .table('migration_record_outcomes')
      .where({ migration_job_id: migrationJobId })
      .max('attempt as max')
      .first();
    return Number(row?.max ?? 0);
  }
}
