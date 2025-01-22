import { JobService } from '@/services/job.service';
import { JobStatus } from '@/types/job.d';
import { createTenantKnex } from '@/lib/db';
import { getAdminConnection } from '../db/admin';

export interface JobMetrics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  active: number;
  queued: number;
}

export async function getQueueMetricsAction(): Promise<JobMetrics> {
  const adminConnection = await getAdminConnection();
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('TENANT_ID environment variable not set');
  }

  // Get counts for each job status
  const [total, completed, failed, pending, active, queued] = await Promise.all([
    adminConnection('jobs').where('tenant', tenant).count('*').first(),
    adminConnection('jobs').where({ tenant, status: JobStatus.Completed }).count('*').first(),
    adminConnection('jobs').where({ tenant, status: JobStatus.Failed }).count('*').first(),
    adminConnection('jobs').where({ tenant, status: JobStatus.Pending }).count('*').first(),
    adminConnection('jobs').where({ tenant, status: JobStatus.Active }).count('*').first(),
    adminConnection('jobs').where({ tenant, status: JobStatus.Queued }).count('*').first(),
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

export async function getJobHistoryAction(filter: {
  state?: JobStatus;
  startAfter?: Date;
  beforeDate?: Date;
  jobName?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}) {
  const { knex, tenant } = await createTenantKnex();
  const adminConnection = await getAdminConnection();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  let query = adminConnection('jobs')
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
  
  // Get details for each job
  const jobService = await JobService.create();
  const jobsWithDetails = await Promise.all(
    jobs.map(async job => ({
      ...job,
      details: await jobService.getJobDetails(job.job_id)
    }))
  );

  return jobsWithDetails;
}