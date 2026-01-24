'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { JobStatus } from '@alga-psa/jobs';
import { createTenantKnex } from '@alga-psa/db';
import { JobService } from '@alga-psa/jobs';
import { withAuth } from '@alga-psa/auth';

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
