'use server';

import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { JobStatus } from 'server/src/types/job';
import { createTenantKnex } from 'server/src/lib/db';
import { JobService } from 'server/src/services/job.service';

export interface JobMetrics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  active: number;
  queued: number;
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
}

export async function getQueueMetricsAction(): Promise<JobMetrics> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('TENANT environment variable not set');
  }

  const tenantFilter = { tenant };

  // Get counts for each job status scoped to the active tenant
  const [total, completed, failed, pending, active, queued] = await Promise.all([
    knex('jobs').where(tenantFilter).count('*').first(),
    knex('jobs').where(tenantFilter).where({ status: JobStatus.Completed }).count('*').first(),
    knex('jobs').where(tenantFilter).where({ status: JobStatus.Failed }).count('*').first(),
    knex('jobs').where(tenantFilter).where({ status: JobStatus.Pending }).count('*').first(),
    knex('jobs').where(tenantFilter).where({ status: JobStatus.Active }).count('*').first(),
    knex('jobs').where(tenantFilter).where({ status: JobStatus.Queued }).count('*').first(),
  ]);

  return {
    total: parseInt(String(total?.count || '0'), 10),
    completed: parseInt(String(completed?.count || '0'), 10),
    failed: parseInt(String(failed?.count || '0'), 10),
    pending: parseInt(String(pending?.count || '0'), 10),
    active: parseInt(String(active?.count || '0'), 10),
    queued: parseInt(String(queued?.count || '0'), 10),
  };
}

export async function getJobDetailsWithHistory(filter: {
  state?: JobStatus;
  startAfter?: Date;
  beforeDate?: Date;
  jobName?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}): Promise<JobRecord[]> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
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
      jobs.map(async job => ({
        ...job,
        details: await jobService.getJobDetails(job.job_id, trx)
      }))
    );

    return jobsWithDetails;
  });
}
