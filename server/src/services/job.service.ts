import { JobScheduler } from '../lib/jobs/jobScheduler';
import { StorageService } from '@/lib/storage/StorageService';
import { JobStatus } from '../types/job.d';
import { createTenantKnex } from '@/lib/db';

export interface JobStep {
  stepName: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface JobStepResult {
  step: string;
  status: 'started' | 'completed' | 'failed';
  invoiceId?: string;
  file_id?: string;
  document_id?: string;
  storage_path?: string;
  recipientEmail?: string;
  error?: string;
  path?: string;
  company_id?: string;
  details?: string;
}

export interface JobHeader {
  id: string;
  type: string;
  status: JobStatus;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface JobDetail {
  id: string;
  stepName: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processedAt?: Date;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

export interface JobData {
  id?: string;
  jobServiceId?: string;
  tenantId: string;
  jobName?: string;
  status?: JobStatus;
  scheduledJobId?: string | null;
  error?: string;
  steps?: JobStep[];
  stepResults?: JobStepResult[];
  [key: string]: any;
}

export type ScheduleType = 'immediate' | 'scheduled' | 'recurring';

export interface ScheduleOptions {
  runAt?: Date;
  interval?: string;
}

export interface JobStatusUpdate {
  error?: any;
  tenantId: string;
  pgBossJobId?: string;
  stepResult?: JobStepResult;
  details?: string;
}

export class JobService {
  private static instance: JobService | null = null;

  constructor(private storageService: StorageService) {}

  public static async create(): Promise<JobService> {
    if (!JobService.instance) {
      JobService.instance = new JobService(new StorageService());
    }
    return JobService.instance;
  }

  async createJob(
    jobName: string,
    data: Omit<JobData, 'jobName' | 'status'>,
    steps?: JobStep[]
  ): Promise<string> {
    const jobRecord = await this.createJobRecord({
      ...data,
      jobName,
      steps
    });
    return jobRecord.id!;
  }

  async createAndScheduleJob(
    jobName: string,
    data: JobData,
    scheduleType: ScheduleType = 'immediate',
    options?: ScheduleOptions
  ): Promise<{ jobRecord: JobData; scheduledJobId: string | null }> {
    // Create job record in the database
    const jobRecord = await this.createJobRecord({
      ...data,
      jobName
    });
    
    // Get job scheduler instance
    const scheduler = await JobScheduler.getInstance(this, this.storageService);
    let scheduledJobId: string | null = null;

    try {
      // Include jobServiceId in the data sent to pg-boss
      const jobData = {
        ...data,
        jobServiceId: jobRecord.id
      };

      switch (scheduleType) {
        case 'immediate':
          scheduledJobId = await scheduler.scheduleImmediateJob(jobName, jobData);
          break;
        case 'scheduled':
          if (!options?.runAt) {
            throw new Error('runAt is required for scheduled jobs');
          }
          scheduledJobId = await scheduler.scheduleScheduledJob(jobName, options.runAt, jobData);
          break;
        case 'recurring':
          if (!options?.interval) {
            throw new Error('interval is required for recurring jobs');
          }
          scheduledJobId = await scheduler.scheduleRecurringJob(jobName, options.interval, jobData);
          break;
      }

      // Update job record with the scheduled job ID
      if (scheduledJobId) {
        await this.updateJobRecord(jobRecord.id, { 
          scheduledJobId,
          status: JobStatus.Queued 
        });
        jobRecord.scheduledJobId = scheduledJobId;
        jobRecord.status = JobStatus.Queued;
      }
    } catch (error: any) {
      await this.updateJobRecord(jobRecord.id, { 
        error: error.message, 
        status: JobStatus.Failed 
      });
      throw error;
    }

    return { jobRecord, scheduledJobId };
  }

  async updateJobStatus(
    jobId: string, 
    status: JobStatus, 
    updates: JobStatusUpdate
  ): Promise<void> {
    const updateData: Partial<JobData> = {
      status,
      scheduledJobId: updates.pgBossJobId
    };

    if (updates.error) {
      updateData.error = typeof updates.error === 'string' 
        ? updates.error 
        : updates.error.message || JSON.stringify(updates.error);
    }

    if (updates.stepResult) {
      updateData.stepResults = updateData.stepResults || [];
      updateData.stepResults.push(updates.stepResult);
    }

    if (updates.details) {
      updateData.details = updates.details;
    }

    await this.updateJobRecord(jobId, updateData);
  }

  async getJobDetails(jobId: string): Promise<JobDetail[]> {
    const { knex } = await createTenantKnex();
    
    // Get job details from job_details table with correct column names
    const details = await knex('job_details')
      .select(
        'detail_id as id',
        'step_name as stepName',
        'step_name as type', // Using step_name for type since there's no type column
        'status',
        'processed_at as processedAt',
        'retry_count as retryCount',
        'metadata'
      )
      .where('job_id', jobId)
      .orderBy('processed_at', 'asc');

    return details.map(detail => ({
      ...detail,
      metadata: detail.metadata ? JSON.parse(detail.metadata) : undefined
    }));
  }

  private async createJobRecord(data: Partial<JobData>): Promise<JobData> {
    // This is a mock implementation, replace with actual DB insertion logic
    const id = Date.now().toString();
    const jobRecord: JobData = {
      id,
      tenantId: data.tenantId!,
      status: JobStatus.Pending,
      stepResults: [],
      ...data
    };
    
    // TODO: Implement actual database insertion
    console.log('Job record created:', jobRecord);
    return jobRecord;
  }

  private async updateJobRecord(id: string | undefined, updates: Partial<JobData>): Promise<void> {
    if (!id) {
      throw new Error('Job ID is required for updates');
    }
    
    // TODO: Implement actual database update
    console.log(`Job record ${id} updated with:`, updates);
  }
}