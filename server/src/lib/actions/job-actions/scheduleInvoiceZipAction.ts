'use server'

import { JobScheduler } from '@/lib/jobs/jobScheduler';
import { getCurrentUser } from '../user-actions/userActions';
import logger from '@/utils/logger';
import { JobService } from '@/services/job.service';
import { createTenantKnex } from '@/lib/db';
import { StorageService } from '@/lib/storage/StorageService';
import { JobStatus } from '@/types/job.d';
import { InvoiceZipJobHandler, type InvoiceZipJobData } from '@/lib/jobs/handlers/invoiceZipHandler';

export async function scheduleInvoiceZipAction(invoiceIds: string[]) {
  const user = await getCurrentUser();
  if (!user || !user.user_id) {
    throw new Error('Unauthorized - No user session found');
  }

  const {knex, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant ID is required');
  }

  const jobService = await JobService.create();
  const storageService = new StorageService();
  const scheduler = await JobScheduler.getInstance(jobService, storageService);
  
  // Create and register invoice zip handler
  const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
  scheduler.registerGenericJobHandler<InvoiceZipJobData>('invoice_zip',
    (jobId, data: InvoiceZipJobData) => invoiceZipHandler.handleInvoiceZipJob(jobId, data)
  );

  try {
    // Create steps for each invoice + zip creation
    const steps = [
      ...invoiceIds.map((id, index) => ({
        stepName: `Process Invoice ${index + 1}`,
        metadata: { invoiceId: id, tenantId: tenant }
      })),
      {
        stepName: 'Create ZIP Archive',
        metadata: { tenantId: tenant }
      }
    ];

    // Create JobService record first
    const jobServiceId = await jobService.createJob(
      'invoice_zip',
      { 
        user_id: user.user_id,
        tenantId: tenant,
        pgBossJobId: null // Will be updated after scheduling
      },
      steps
    );

    // Schedule pg-boss job with JobService ID
    const jobData: InvoiceZipJobData = {
      jobServiceId,
      invoiceIds,
      requesterId: user.user_id,
      tenantId: tenant,
      metadata: {
        user_id: user.user_id,
        invoice_count: invoiceIds.length,
        tenantId: tenant
      }
    };
    
    const queueJobId = await scheduler.scheduleImmediateJob('invoice_zip', jobData);
    if (!queueJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }

    // Update JobService record with pg-boss job ID
    await jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
      pgBossJobId: queueJobId,
      tenantId: tenant
    });

    return { jobId: jobServiceId };
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