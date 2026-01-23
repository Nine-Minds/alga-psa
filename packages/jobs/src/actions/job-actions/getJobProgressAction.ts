'use server';

import { withAdminTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

import { JobStatus } from '@alga-psa/jobs';
import type { JobHeader, JobDetail } from '@alga-psa/jobs';
import { JobMetrics } from '@alga-psa/jobs/actions';

export interface JobProgressData {
  header: JobHeader;
  details: JobDetail[];
  metrics: JobMetrics;
}

export const getJobProgressAction = withAuth(async (user, { tenant }, jobId: string): Promise<JobProgressData> => {
  try {
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

    if (!header) {
      throw new Error(`Job not found: ${jobId}`);
    }

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
    console.error('Error fetching job progress:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to get job progress');
  }
});
