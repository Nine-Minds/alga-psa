'use server'

import { JobService } from '@/services/job.service';
import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '../user-actions/userActions';
import { JobStatus } from '@/types/job.d';
import logger from '@/utils/logger';

export const scheduleInvoiceEmailAction = async (invoiceIds: string[]) => {
  const { tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  if (!tenant || !currentUser) throw new Error('Tenant or user not found');

  const jobService = await JobService.create();
  const steps = invoiceIds.flatMap(invoiceId => [
    {
      stepName: `Generate PDF for Invoice ${invoiceId}`,
      type: 'pdf_generation',
      metadata: { invoiceId, tenantId: tenant }
    },
    {
      stepName: `Send Email for Invoice ${invoiceId}`,
      type: 'email_sending',
      metadata: { invoiceId, tenantId: tenant }
    }
  ]);

  const jobData = {
    invoiceIds,
    tenantId: tenant,
    user_id: currentUser.user_id,
    steps,
    metadata: {
      user_id: currentUser.user_id,
      invoice_count: invoiceIds.length,
      tenantId: tenant
    }
  };

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob(
      'invoice_email',
      jobData,
      'immediate'
    );
    if (!scheduledJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }
    return { jobId: jobRecord.id };
  } catch (error) {
    logger.error('Failed to schedule invoice email job', {
      error,
      userId: currentUser.user_id,
      invoiceIds
    });
    throw new Error('Failed to schedule invoice email job');
  }
};
