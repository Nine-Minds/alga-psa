'use server'

import { getCurrentUser } from '../user-actions/userActions';
import logger from '@/utils/logger';
import { JobService, type JobData } from '@/services/job.service';
import { createTenantKnex } from '@/lib/db';
import { JobStatus } from '@/types/job.d';
import { type InvoiceZipJobData } from '@/lib/jobs/handlers/invoiceZipHandler';

// Type for initial job data before we have the jobServiceId
interface InitialJobData extends JobData {
  requesterId: string;
  user_id: string;
  invoiceIds: string[];
  metadata: {
    user_id: string;
    invoice_count: number;
    tenantId: string;
  };
}

export async function scheduleInvoiceZipAction(invoiceIds: string[]) {
  const user = await getCurrentUser();
  if (!user || !user.user_id) {
    throw new Error('Unauthorized - No user session found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant ID is required');
  }

  const jobService = await JobService.create();

  const steps = [
    ...invoiceIds.map((id, index) => ({
      stepName: `Process Invoice ${index + 1}`,
      type: 'invoice_processing',
      metadata: { invoiceId: id, tenantId: tenant }
    })),
    {
      stepName: 'Create ZIP Archive',
      type: 'zip_creation',
      metadata: { tenantId: tenant }
    }
  ];

  const jobData: InitialJobData = {
    requesterId: user.user_id,
    user_id: user.user_id,
    tenantId: tenant,
    invoiceIds,
    steps,
    metadata: {
      user_id: user.user_id,
      invoice_count: invoiceIds.length,
      tenantId: tenant
    }
  };

  console.log('Invoice zip job data:', jobData);

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob(
      'invoice_zip',
      jobData,
      'immediate'
    );
    if (!scheduledJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }
    return { jobId: jobRecord.id };
  } catch (error) {
    console.log('Error in scheduleInvoiceZipAction:', error);
    logger.error('Failed to schedule invoice zip job', {
      error,
      userId: user.user_id,
      invoiceIds
    });
    throw new Error('Failed to schedule invoice zip job');
  }
}