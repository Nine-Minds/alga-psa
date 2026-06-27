'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
// Import from the concrete modules rather than the '@alga-psa/jobs' barrel: this
// file is itself reached via the barrel's `export * from './actions'`, so a
// self-import would read these before the barrel finishes initializing. The
// top-level TERMINAL_JOB_STATUSES below evaluates JobStatus at module load, so
// that cycle would leave it undefined. See sibling files (jobService, schedulers).
import { JobStatus } from '../types/job';
import { createTenantKnex } from '@alga-psa/db';
import { JobService } from '../lib/jobService';
import { withAuth, hasPermission } from '@alga-psa/auth';

export interface JobMetrics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  active: number;
  queued: number;
  byRunner: {
    pgboss: number;
    temporal: number;
  };
}

export interface JobRecord {
  job_id: string;
  tenant: string;
  type: string;
  status: string;
  metadata?: any;
  created_at: Date;
  updated_at?: Date;
  processed_at?: Date;
  user_id?: string;
  details?: any[];
  runner_type?: string;
  external_id?: string;
  external_run_id?: string;
}

export const getQueueMetricsAction = withAuth(async (user, { tenant }): Promise<JobMetrics> => {
  const { knex } = await createTenantKnex();

  // Get all counts in a single query using conditional aggregation
  const result = await knex('jobs')
    .where({ tenant })
    .select(
      knex.raw('COUNT(*) as total'),
      knex.raw(`COUNT(*) FILTER (WHERE status = ?) as completed`, [JobStatus.Completed]),
      knex.raw(`COUNT(*) FILTER (WHERE status = ?) as failed`, [JobStatus.Failed]),
      knex.raw(`COUNT(*) FILTER (WHERE status = ?) as pending`, [JobStatus.Pending]),
      knex.raw(`COUNT(*) FILTER (WHERE status = ?) as active`, [JobStatus.Active]),
      knex.raw(`COUNT(*) FILTER (WHERE status = ?) as queued`, [JobStatus.Queued]),
      knex.raw(`COUNT(*) FILTER (WHERE runner_type = 'pgboss') as pgboss`),
      knex.raw(`COUNT(*) FILTER (WHERE runner_type = 'temporal') as temporal`)
    )
    .first() as unknown as { total: string; completed: string; failed: string; pending: string; active: string; queued: string; pgboss: string; temporal: string } | undefined;

  return {
    total: parseInt(String(result?.total || '0'), 10),
    completed: parseInt(String(result?.completed || '0'), 10),
    failed: parseInt(String(result?.failed || '0'), 10),
    pending: parseInt(String(result?.pending || '0'), 10),
    active: parseInt(String(result?.active || '0'), 10),
    queued: parseInt(String(result?.queued || '0'), 10),
    byRunner: {
      pgboss: parseInt(String(result?.pgboss || '0'), 10),
      temporal: parseInt(String(result?.temporal || '0'), 10),
    },
  };
});

export const getJobDetailsWithHistory = withAuth(async (user, { tenant }, filter: {
  state?: JobStatus;
  startAfter?: Date;
  beforeDate?: Date;
  jobName?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}): Promise<JobRecord[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Build and execute jobs query scoped explicitly to the tenant
    let query = trx('jobs')
      .select('*')
      .where('tenant', tenant)
      .orderBy('created_at', 'desc');

    if (filter.state) {
      query = query.where('status', filter.state);
    }
    if (filter.startAfter) {
      query = query.where('created_at', '>', filter.startAfter);
    }
    if (filter.beforeDate) {
      query = query.where('created_at', '<', filter.beforeDate);
    }
    if (filter.jobName) {
      query = query.where('type', filter.jobName);
    }
    if (filter.limit) {
      query = query.limit(filter.limit);
    }
    if (filter.offset) {
      query = query.offset(filter.offset);
    }

    const jobs = await query;

    if (jobs.length === 0) {
      return [];
    }

    // Get job details using the service method with the same transaction
    const jobService = await JobService.create();
    const jobsWithDetails = await Promise.all(
      jobs.map(async (job) => ({
        ...job,
        details: await jobService.getJobDetails(job.job_id, trx),
      }))
    );

    return jobsWithDetails;
  });
});

/**
 * Which jobs the clear targets, decomposed into two independent axes so every
 * combination is reachable (notably "finished jobs older than N days"):
 * - `scope`: `finished` (completed/failed only, leaving in-flight work) or
 *   `all` (every status, including pending/queued/running).
 * - `olderThanDays`: an optional age cutoff. When set, only jobs created more
 *   than N days ago are removed; omit (or null) to ignore age.
 */
export type ClearJobHistoryScope = 'finished' | 'all';

export interface ClearJobHistoryParams {
  scope: ClearJobHistoryScope;
  /** Optional age cutoff in days; a positive integer when provided. */
  olderThanDays?: number | null;
}

export interface ClearJobHistoryResult {
  deletedJobs: number;
}

/** Jobs in a terminal state are safe to clear without disrupting in-flight work. */
const TERMINAL_JOB_STATUSES = [JobStatus.Completed, JobStatus.Failed];

function badRequest(message: string): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  throw error;
}

function forbidden(message: string): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = 403;
  throw error;
}

/**
 * Clears the calling tenant's job monitoring history (the `jobs` and
 * `job_details` tables only — the pg-boss queue engine is left untouched).
 *
 * Requires the MSP `job:delete` permission. Deletions are tenant-scoped and run
 * in a single transaction, removing `job_details` before `jobs` to satisfy the
 * foreign key.
 */
export const clearJobHistoryAction = withAuth(async (
  user,
  { tenant },
  params: ClearJobHistoryParams
): Promise<ClearJobHistoryResult> => {
  if ((user as { user_type?: string }).user_type === 'client') {
    forbidden('MSP user required');
  }

  const { knex } = await createTenantKnex();

  const allowed = await hasPermission(user, 'job', 'delete', knex);
  if (!allowed) {
    forbidden('Permission "job:delete" required');
  }

  if (params.scope !== 'finished' && params.scope !== 'all') {
    badRequest(`Unknown clear scope: ${String(params.scope)}`);
  }

  let cutoff: Date | null = null;
  if (params.olderThanDays !== undefined && params.olderThanDays !== null) {
    const days = params.olderThanDays;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
      badRequest('olderThanDays must be a positive integer');
    }
    cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  // Applies the same tenant-scoped predicate to any builder over `jobs`, so the
  // job_details subquery and the jobs delete target an identical row set. The
  // scope (status) and age (cutoff) axes compose with AND.
  const applyFilters = (query: Knex.QueryBuilder): Knex.QueryBuilder => {
    query.where('tenant', tenant);
    if (params.scope === 'finished') {
      query.whereIn('status', TERMINAL_JOB_STATUSES);
    }
    if (cutoff) {
      query.where('created_at', '<', cutoff);
    }
    return query;
  };

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Child rows first: job_details has a FK to jobs(tenant, job_id).
    await trx('job_details')
      .where('tenant', tenant)
      .whereIn('job_id', applyFilters(trx('jobs').select('job_id')))
      .delete();

    const deletedJobs = await applyFilters(trx('jobs')).delete();

    return { deletedJobs };
  });
});
