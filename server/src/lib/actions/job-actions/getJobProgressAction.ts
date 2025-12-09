'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { withAdminTransaction } from '@shared/db/index';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';

import { JobStatus } from 'server/src/types/job';
import type { JobHeader, JobDetail } from 'server/src/services/job.service';
import { JobMetrics } from 'server/src/lib/actions/job-actions';

export interface JobProgressData {
  header: JobHeader;
  details: JobDetail[];
  metrics: JobMetrics;
}

export async function getJobProgressAction(jobId: string): Promise<JobProgressData> {
  const user = await getCurrentUser();
  
  if (!user || !user.user_id || !user.tenant) {
    throw new Error('Unauthorized - Invalid user session');
  }

  try {
    const {tenant} = await createTenantKnex();
    console.log('Fetching job progress:', { jobId, tenant }); // Debug log

    if (!tenant) {
      throw new Error('No tenant found');
    }

    const { header, details } = await withAdminTransaction(async (trx: Knex.Transaction) => {
      const [headerResult] = await trx('jobs as j')
        .select(
          'j.job_id as id',
          'j.type as name',
          'j.status',
          'j.created_at as createdOn'
        )
        .where('j.job_id', jobId)
        .andWhere('j.tenant', tenant);

      const detailsResult = await trx('job_details as jd')
        .select(
          'jd.detail_id as id',
          'jd.step_name as stepName',
          'jd.status',
          'jd.processed_at as processedAt',
          'jd.retry_count as retryCount',
          'jd.result'
        )
        .where('jd.job_id', jobId)
        .andWhere('jd.tenant', tenant)
        .orderBy('jd.processed_at', 'asc');

      return { header: headerResult, details: detailsResult };
    });

    console.log('Job query result:', { header, details }); // Debug log

    if (!header) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // await auditLog({
    //   userId: user.user_id,
    //   tenantId: tenant,
    //   action: 'get_job_progress',
    //   details: { jobId }
    // });

    // Convert dates to proper format
    return {
      header: {
        id: header.id,
        type: header.name,
        status: header.status as JobStatus,
        createdAt: header.createdOn ? new Date(header.createdOn) : new Date()
      },
      details: details.map(detail => ({
        ...detail,
        processedAt: detail.processedAt ? new Date(detail.processedAt) : undefined
      })),
      metrics: {
        total: details.length,
        completed: details.filter(d => d.status === JobStatus.Completed).length,
        failed: details.filter(d => d.status === 'Failed').length,
        pending: details.filter(d => d.status === 'Pending').length,
        active: details.filter(d => d.status === 'Pending').length,
        queued: details.filter(d => d.status === 'Pending').length,
        byRunner: {
          pgboss: 0,
          temporal: 0
        }
      }
    };
  } catch (error) {
    console.error('Error fetching job progress:', error); // Debug log
    
    // await auditLog({
    //   userId: user.user_id,
    //   tenantId: tenant,
    //   action: 'get_job_progress_error',
    //   details: {
    //     error: error instanceof Error ? error.message : 'Unknown error',
    //     jobId
    //   }
    // });

    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to get job progress');
  }
}