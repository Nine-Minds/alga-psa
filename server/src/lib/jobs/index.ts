import { Job } from 'pg-boss';
import { JobScheduler, JobFilter } from './jobScheduler';
import { InvoiceZipJobHandler } from '@/lib/jobs/handlers/invoiceZipHandler';
import type { InvoiceZipJobData } from '@/lib/jobs/handlers/invoiceZipHandler';
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';
import { JobService } from '../../services/job.service';
import { getConnection } from '../db/db';
import { StorageService } from '../../lib/storage/StorageService';

// Initialize the job scheduler singleton
let jobScheduler: JobScheduler;

// Initialize function to ensure scheduler is ready
export const initializeScheduler = async (storageService?: StorageService) => {
  if (!jobScheduler) {
    const rootKnex = await getConnection(null);
    const jobService = await JobService.create();
    const storageService = new StorageService();
    jobScheduler = await JobScheduler.getInstance(jobService, storageService);
    
    // Register job handlers
    jobScheduler.registerJobHandler<GenerateInvoiceData>('generate-invoice', async (job: Job<GenerateInvoiceData>) => {
      await generateInvoiceHandler(job.data);
    });
    
    // Register invoice zip handlers if storageService is provided
    if (storageService && jobService) {
      const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
      jobScheduler.registerGenericJobHandler<InvoiceZipJobData>('invoice_zip',
        (jobId, data: InvoiceZipJobData) => invoiceZipHandler.handleInvoiceZipJob(jobId, data));
    }
  }
  return jobScheduler;
};

// Export types
export type { JobFilter, GenerateInvoiceData };

// Export job scheduling helper functions
export const scheduleInvoiceGeneration = async (
  companyId: string,
  billingCycleId: string,
  runAt: Date,
  tenantId: string
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleScheduledJob<GenerateInvoiceData>(
    'generate-invoice',
    runAt,
    { companyId, billingCycleId, tenantId }
  );
};

// Export monitoring functions
export interface JobHistoryFilter {
  jobName?: string;
  startDate?: Date;
  endDate?: Date;
  status?: 'completed' | 'failed' | 'active' | 'expired';
  limit?: number;
  offset?: number;
}

export const getJobHistory = async (
  tenantId: string,
  filters: JobHistoryFilter
): Promise<unknown[]> => {
  const scheduler = await initializeScheduler();
  return await scheduler.getJobHistory({
    tenantId,
    jobName: filters.jobName,
    startAfter: filters.startDate,
    beforeDate: filters.endDate,
    state: filters.status,
    limit: filters.limit,
    offset: filters.offset
  });
};

export const getQueueStatus = async (): Promise<{
  active: number;
  completed: number;
  failed: number;
  queued: number;
}> => {
  const scheduler = await initializeScheduler();
  return await scheduler.getQueueMetrics();
};

export interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

export const getJobDetails = async (jobId: string): Promise<JobDetails | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.getJobById(jobId);
};

export const scheduleImmediateJob = async <T extends Record<string, unknown>>(
  jobName: string,
  data: T
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleImmediateJob(jobName, data);
};

export const cancelScheduledJob = async (jobId: string): Promise<boolean> => {
  const scheduler = await initializeScheduler();
  return await scheduler.cancelJob(jobId);
};
