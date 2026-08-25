import type { Job } from 'pg-boss';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { runWithTenant } from '@/lib/db';
import { MigrationDomainApplier } from '@/lib/migrations/appliers/MigrationDomainApplier';
import { MigrationPlanner } from '@/lib/migrations/MigrationPlanner';

export interface MigrationApplyJobData extends Record<string, unknown> {
  tenantId: string;
  userId: string;
  migrationJobId: string;
  jobServiceId?: string;
}

/**
 * Background application of a staged migration job.
 *
 * Order of operations: re-preflight (a stale plan never applies against a
 * moved target), mark applying, run the dependency-ordered appliers with
 * per-batch transactions and cancellation checkpoints, then record the
 * truthful terminal state. Every mutation-outcome-identity write happens
 * inside MigrationDomainApplier's batch transactions; this handler only
 * transitions job state.
 */
export async function handleMigrationApplyJob(job: Job<MigrationApplyJobData>): Promise<void> {
  const { tenantId, userId, migrationJobId } = job.data;
  if (!tenantId) {
    throw new Error('tenantId is required in job payload');
  }
  if (!migrationJobId) {
    throw new Error('migrationJobId is required in job payload');
  }
  if (!userId) {
    throw new Error('userId is required in job payload');
  }

  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex(tenantId);
    const db = tenantDb(knex, tenantId);

    const migrationJob = await db
      .table('migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .first();
    if (!migrationJob) {
      throw new Error(`Migration job ${migrationJobId} was not found for tenant ${tenantId}`);
    }
    if (!['queued', 'applying'].includes(migrationJob.state)) {
      throw new Error(`Migration job ${migrationJobId} is in state ${migrationJob.state}; not runnable.`);
    }

    try {
      // A stale plan never applies: preflight re-runs immediately before apply.
      const planner = new MigrationPlanner(knex, tenantId);
      const preflight = await planner.preflight(migrationJobId);
      if (preflight.state === 'blocked') {
        await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
          state: 'blocked',
          error: 'Preflight re-check before apply found blocking issues; nothing was applied.',
          updated_at: knex.fn.now(),
        });
        return;
      }

      await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
        state: 'applying',
        started_at: migrationJob.started_at ?? knex.fn.now(),
        updated_at: knex.fn.now(),
      });
      // Progress counters describe the current run; reset before applying.
      await db
        .table('migration_job_entities')
        .where({ migration_job_id: migrationJobId })
        .update({ state: 'pending', applied_count: 0, skipped_count: 0, failed_count: 0 });

      const applier = new MigrationDomainApplier(knex, tenantId);
      const result = await applier.applyJob(migrationJobId, userId);

      const terminalState = result.cancelled
        ? 'cancelled'
        : result.failed > 0
          ? 'completed_with_errors'
          : 'completed';

      await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
        state: terminalState,
        completed_at: knex.fn.now(),
        error: null,
        updated_at: knex.fn.now(),
      });
    } catch (error) {
      await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
        state: 'failed',
        error: (error as Error).message,
        updated_at: knex.fn.now(),
      });
      throw error;
    }
  });
}
