import { JobScheduler, JobFilter } from './jobScheduler';
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';

// Initialize the job scheduler singleton
const jobScheduler = JobScheduler.getInstance();

// Register job handlers
jobScheduler.registerJobHandler<GenerateInvoiceData>('generate-invoice', generateInvoiceHandler);

// Export types
export type { JobFilter, GenerateInvoiceData };

// Export job scheduling helper functions
export const scheduleInvoiceGeneration = async (
  companyId: string,
  billingCycleId: string,
  runAt: Date,
  tenantId: string
): Promise<string | null> => {
  return await jobScheduler.scheduleScheduledJob<GenerateInvoiceData>(
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
  return await jobScheduler.getJobHistory({
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
  return await jobScheduler.getQueueMetrics();
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
  return await jobScheduler.getJobById(jobId);
};

export const cancelScheduledJob = async (jobId: string): Promise<boolean> => {
  return await jobScheduler.cancelJob(jobId);
};
