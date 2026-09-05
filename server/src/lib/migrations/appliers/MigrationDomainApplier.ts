import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import { MigrationLedger } from '../MigrationLedger';
import { parseConfiguration } from '../MigrationPlanner';
import { MIGRATION_PHASE_ORDER } from '../types';
import { ApplierContext } from './context';
import { ENTITY_APPLIERS } from './entityAppliers';

const APPLY_BATCH_SIZE = 25;

export interface ApplyRunResult {
  cancelled: boolean;
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Applies staged records in dependency order with bounded per-batch
 * transactions. The retry contract: every target mutation commits in the same
 * transaction as its outcome row and identity mapping, so a worker killed
 * mid-apply resumes without double-writing — already-applied records are
 * skipped through the ledger on the next attempt. Cancellation is honored at
 * batch checkpoints; no transaction is ever held across the package.
 */
export class MigrationDomainApplier {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async applyJob(migrationJobId: string, actorUserId: string): Promise<ApplyRunResult> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
    if (!job) {
      throw new Error(`Migration job ${migrationJobId} was not found in this tenant`);
    }

    const ledger = new MigrationLedger(this.tenant);
    const attempt = (await ledger.latestAttempt(this.knex, migrationJobId)) + 1;
    const context = new ApplierContext(
      this.tenant,
      migrationJobId,
      attempt,
      actorUserId,
      parseConfiguration(job.configuration),
      ledger
    );

    const totals: ApplyRunResult = { cancelled: false, created: 0, skipped: 0, failed: 0 };

    for (const entityType of MIGRATION_PHASE_ORDER) {
      const hasRecords = await db
        .table('migration_staged_records')
        .where({ migration_job_id: migrationJobId, entity_type: entityType })
        .first();
      if (!hasRecords) {
        continue;
      }

      await this.setEntityState(migrationJobId, entityType, 'applying');
      const cancelled = await this.applyEntity(migrationJobId, entityType, context, totals);
      if (cancelled) {
        await this.setEntityState(migrationJobId, entityType, 'cancelled');
        totals.cancelled = true;
        return totals;
      }
      await this.setEntityState(migrationJobId, entityType, 'completed');
    }

    return totals;
  }

  private async applyEntity(
    migrationJobId: string,
    entityType: AmpEntityType,
    context: ApplierContext,
    totals: ApplyRunResult
  ): Promise<boolean> {
    const applier = ENTITY_APPLIERS[entityType];
    let lastPackageRecordId = '';

    for (;;) {
      if (await this.cancelRequested(migrationJobId)) {
        return true;
      }

      const db = tenantDb(this.knex, this.tenant);
      const batch = await db
        .table('migration_staged_records')
        .where({
          migration_job_id: migrationJobId,
          entity_type: entityType,
          validation_state: 'valid',
        })
        .where('package_record_id', '>', lastPackageRecordId)
        .orderBy('package_record_id')
        .limit(APPLY_BATCH_SIZE);

      if (batch.length === 0) {
        return false;
      }
      lastPackageRecordId = batch[batch.length - 1].package_record_id;

      const counters = { created: 0, skipped: 0, failed: 0 };

      for (const staged of batch) {
        await withTransaction(this.knex, async (trx) => {
          const payload =
            typeof staged.payload === 'string' ? JSON.parse(staged.payload) : staged.payload;
          const identityKey = {
            namespace: staged.namespace,
            entityType,
            sourceRecordId: staged.source_record_id,
          };

          const existing = await context.ledger.findMapping(trx, identityKey);
          if (existing) {
            await context.ledger.recordOutcome(trx, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: 'skipped',
              targetEntityType: existing.targetEntityType,
              targetEntityId: existing.targetEntityId,
            });
            counters.skipped += 1;
            return;
          }

          try {
            const applied = await applier.apply(trx, context, payload);
            await context.ledger.recordCreation(trx, identityKey, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: 'created',
              targetEntityType: applied.targetEntityType,
              targetEntityId: applied.targetEntityId,
              warnings: applied.warnings,
            });
            counters.created += 1;
          } catch (error) {
            await context.ledger.recordOutcome(trx, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: 'failed',
              errors: [(error as Error).message],
            });
            counters.failed += 1;
          }
        });
      }
      await withTransaction(this.knex, async (trx) => {
        const tx = tenantDb(trx, this.tenant);
        await tx
          .table('migration_job_entities')
          .where({ migration_job_id: migrationJobId, entity_type: entityType })
          .update({
            applied_count: this.knex.raw('applied_count + ?', [counters.created]),
            skipped_count: this.knex.raw('skipped_count + ?', [counters.skipped]),
            failed_count: this.knex.raw('failed_count + ?', [counters.failed]),
            updated_at: trx.fn.now(),
          });
      });

      totals.created += counters.created;
      totals.skipped += counters.skipped;
      totals.failed += counters.failed;
    }
  }

  private async cancelRequested(migrationJobId: string): Promise<boolean> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db
      .table('migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .select('cancel_requested_at')
      .first();
    return Boolean(job?.cancel_requested_at);
  }

  private async setEntityState(
    migrationJobId: string,
    entityType: AmpEntityType,
    state: string
  ): Promise<void> {
    const db = tenantDb(this.knex, this.tenant);
    await db
      .table('migration_job_entities')
      .where({ migration_job_id: migrationJobId, entity_type: entityType })
      .update({ state, updated_at: this.knex.fn.now() });
  }
}
