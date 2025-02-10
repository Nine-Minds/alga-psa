import { Job } from 'pg-boss';
import { JobScheduler, JobFilter, IJobScheduler, DummyJobScheduler } from './jobScheduler';
import { InvoiceZipJobHandler } from '@/lib/jobs/handlers/invoiceZipHandler';
import { InvoiceEmailHandler, InvoiceEmailJobData } from '@/lib/jobs/handlers/invoiceEmailHandler';
import type { InvoiceZipJobData } from '@/lib/jobs/handlers/invoiceZipHandler';
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';
import { JobService } from '../../services/job.service';
import { getConnection } from '../db/db';
import { StorageService } from '../../lib/storage/StorageService';
import logger from '@/utils/logger';

// Initialize the job scheduler singleton
let jobScheduler: IJobScheduler;

// Initialize function to ensure scheduler is ready
export const initializeScheduler = async (storageService?: StorageService) => {
  if (!jobScheduler) {
    const rootKnex = await getConnection(null);
    const jobService = await JobService.create();
    const storageService = new StorageService();
    jobScheduler = await JobScheduler.getInstance(jobService, storageService);

    if (!jobScheduler) {
      logger.error('Failed to initialize job scheduler');
      return DummyJobScheduler.getInstance();
    }
    
    // Register job handlers
    jobScheduler.registerJobHandler<GenerateInvoiceData>('generate-invoice', async (job: Job<GenerateInvoiceData>) => {
      await generateInvoiceHandler(job.data);
    });
    
    // Register invoice handlers if storageService is provided
    if (storageService && jobService) {
      const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
      jobScheduler.registerJobHandler<InvoiceZipJobData>('invoice_zip', async (job: Job<InvoiceZipJobData>) => {
        await invoiceZipHandler.handleInvoiceZipJob(job.id, job.data);
      });
        
      // Register invoice email handler
      jobScheduler.registerJobHandler<InvoiceEmailJobData>('invoice_email', async (job: Job<InvoiceEmailJobData>) => {
        if (!job.data || typeof job.data !== 'object') {
          logger.error(`Invalid job data received for invoice_email job ${job.id}`);
          return;
        }
        await InvoiceEmailHandler.handle(job.id, job.data);
      });
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

export interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

export const scheduleImmediateJob = async <T extends Record<string, unknown>>(
  jobName: string,
  data: T
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleImmediateJob(jobName, data);
};
