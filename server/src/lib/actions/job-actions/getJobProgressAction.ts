'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { createTenantKnex } from '@/lib/db';
import { getAdminConnection } from '@/lib/db/admin';

import { JobStatus } from '@/types/job.d';
import type { JobHeader, JobDetail } from '@/services/job.service';
import { JobMetrics } from '@/lib/actions/job-actions';

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
    const {knex, tenant} = await createTenantKnex();
    const adminConnection = await getAdminConnection();
    console.log('Fetching job progress:', { jobId, tenant }); // Debug log

    if (!adminConnection) {
      throw new Error('No admin connection found');
    }

    if (!tenant) {
      throw new Error('No tenant found');
    }

    const [header] = await adminConnection('jobs as j')
      .select(
        'j.job_id as id',
        'j.type as name',
        'j.status',
        'j.created_at as createdOn'
      )
      .where('j.job_id', jobId)
      .andWhere('j.tenant', tenant);

    const details = await adminConnection('job_details as jd')
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
        queued: details.filter(d => d.status === 'Pending').length
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