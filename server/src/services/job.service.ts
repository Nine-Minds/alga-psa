import { JobScheduler } from '../lib/jobs/jobScheduler';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { JobStatus } from '../types/job';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';

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
  client_id?: string;
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
        }, data.tenantId);
        jobRecord.scheduledJobId = scheduledJobId;
        jobRecord.status = JobStatus.Queued;
      }
    } catch (error: any) {
      await this.updateJobRecord(jobRecord.id, { 
        error: error.message, 
        status: JobStatus.Failed 
      }, data.tenantId);
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

    await this.updateJobRecord(jobId, updateData, updates.tenantId);
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
      metadata: detail.metadata ?
        (typeof detail.metadata === 'string' ? JSON.parse(detail.metadata) : detail.metadata)
        : undefined
    }));
  }

  private async createJobRecord(data: Partial<JobData>): Promise<JobData> {
    if (!data.tenantId) {
      throw new Error('Tenant ID is required for job creation');
    }
    return await runWithTenant(data.tenantId, async () => {
      const { knex } = await createTenantKnex();
      
      // Ensure metadata is properly stringified
      const metadataObj = {
        ...data.metadata,
        scheduledJobId: data.scheduledJobId,
        stepResults: data.stepResults || []
      };
  
      const jobRecord = {
        tenant: data.tenantId,
        type: data.jobName,
        status: JobStatus.Pending,
        metadata: typeof metadataObj === 'string' ? metadataObj : JSON.stringify(metadataObj),
        created_at: new Date(),
        user_id: data.metadata?.user_id
      };

      const [inserted] = await knex('jobs')
        .insert(jobRecord)
        .returning('*');

      const metadata = inserted.metadata ?
        (typeof inserted.metadata === 'string' ? JSON.parse(inserted.metadata) : inserted.metadata)
        : {};

      return {
        id: inserted.job_id,
        tenantId: inserted.tenant,
        jobName: inserted.type,
        status: inserted.status,
        scheduledJobId: metadata.scheduledJobId,
        metadata: metadata,
        stepResults: metadata.stepResults || [],
        createdAt: inserted.created_at
      };
    });
  }

  async createJobDetail(jobId: string, stepName: string, status: 'pending' | 'processing' | 'completed' | 'failed', metadata?: Record<string, unknown>): Promise<string> {
    const { knex } = await createTenantKnex();
    
    // Get the tenant ID from the job record
    const job = await knex('jobs')
      .where('job_id', jobId)
      .first('tenant');
      
    if (!job) {
      throw new Error(`Job with ID ${jobId} not found`);
    }

    const [detail] = await knex('job_details')
      .insert({
        tenant: job.tenant,
        job_id: jobId,
        step_name: stepName,
        status,
        processed_at: new Date(),
        retry_count: 0,
        metadata: metadata ? JSON.stringify(metadata) : null,
        result: metadata ? JSON.stringify(metadata) : null // For backward compatibility
      })
      .returning('detail_id');

    return detail.detail_id;
  }

  async updateJobDetailRecord(detailId: string, status: 'pending' | 'processing' | 'completed' | 'failed', metadata?: Record<string, unknown>): Promise<void> {
    const { knex } = await createTenantKnex();
    
    const detail = await knex('job_details')
      .where('detail_id', detailId)
      .first();
      
    if (!detail) {
      throw new Error(`Job detail with ID ${detailId} not found`);
    }

    await knex('job_details')
      .where('detail_id', detailId)
      .update({
        status,
        processed_at: new Date(),
        metadata: metadata ? JSON.stringify(metadata) : null,
        result: metadata ? JSON.stringify(metadata) : null, // For backward compatibility
        retry_count: status === 'failed' ? knex.raw('retry_count + 1') : detail.retry_count
      });
  }

  private async updateJobRecord(id: string | undefined, updates: Partial<JobData>, tenantId?: string): Promise<void> {
    if (!id) {
      throw new Error('Job ID is required for updates');
    }
    const resolvedTenant = tenantId || updates.tenantId;
    if (!resolvedTenant) {
      throw new Error('Tenant ID is required when updating a job record');
    }

    await runWithTenant(resolvedTenant, async () => {
      const { knex } = await createTenantKnex();
      
      const currentJob = await knex('jobs')
        .where('job_id', id)
        .first();

      if (!currentJob) {
        throw new Error(`Job with ID ${id} not found`);
      }

      const currentMetadata = currentJob.metadata ?
        (typeof currentJob.metadata === 'string' ? JSON.parse(currentJob.metadata) : currentJob.metadata)
        : {};

      // Add step results directly without modifying their structure
      const stepResults = updates.stepResults || [];

      const updatedMetadata = {
        ...currentMetadata,
        scheduledJobId: updates.scheduledJobId,
        stepResults: [...(currentMetadata.stepResults || []), ...stepResults]
      };

      const updateData: Record<string, any> = {
        status: updates.status,
        updated_at: new Date(),
        metadata: JSON.stringify(updatedMetadata)
      };

      await knex('jobs')
        .where('job_id', id)
        .update(updateData);
    });
  }
}
