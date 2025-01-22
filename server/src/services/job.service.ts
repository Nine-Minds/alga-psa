import { JobStatus, JobMetadata, JobResult } from '../types/job.d';
import { Knex } from 'knex';
import { getAdminConnection } from '@/lib/db/admin';

export interface JobDetailInput {
  stepName: string;
  initialStatus?: JobStatus;
  metadata?: Record<string, unknown>;
}

export interface JobHeader {
  id: string;
  type: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt?: Date;
}

export interface JobDetail {
  id: string;
  stepName: string;
  status: JobStatus;
  result?: Record<string, unknown>;
  processedAt?: Date;
  retryCount: number;
}

export interface JobMetrics {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
}

export class JobService {
  constructor(private readonly knex: Knex) {
    console.log('JobService initialized with connection:', {
      client: knex.client.config.client,
      connection: knex.client.config.connection
    });
  }

  static async create(): Promise<JobService> {
    const connection = await getAdminConnection(); // null for system connection
    return new JobService(connection);
  }

  async createJob(
    type: string,
    metadata: Record<string, unknown>,
    details?: JobDetailInput[]
  ): Promise<string> {
    if (!metadata.tenantId) {
      throw new Error('tenantId is required in metadata');
    }

    const [job] = await this.knex('jobs')
      .insert({
        type,
        metadata,
        status: JobStatus.Pending,
        tenant: metadata.tenantId,
        user_id: metadata.user_id
      })
      .returning('job_id');

    if (details && details.length > 0) {
      await this.knex('job_details').insert(
        details.map(detail => ({
          job_id: job.job_id,
          step_name: detail.stepName,
          status: detail.initialStatus || JobStatus.Pending,
          metadata: detail.metadata,
          tenant: metadata.tenantId
        }))
      );
    }

    return job.job_id;
  }

  async addJobStep(jobId: string, step: JobDetailInput): Promise<void> {
    if (!step.metadata?.tenantId) {
      throw new Error('tenantId is required in step metadata');
    }

    await this.knex('job_details').insert({
      job_id: jobId,
      step_name: step.stepName,
      status: step.initialStatus || JobStatus.Pending,
      metadata: step.metadata,
      tenant: step.metadata.tenantId
    });
  }

  async updateStepStatus(
    jobId: string,
    stepId: string,
    status: JobStatus,
    result?: Record<string, unknown>
  ): Promise<void> {
    await this.knex('job_details')
      .where({ detail_id: stepId, job_id: jobId })
      .update({
        status,
        result,
        processed_at: this.knex.fn.now(),
        updated_at: this.knex.fn.now()
      });
  }

  async getJobDetails(jobId: string) {
    const details = await this.knex('job_details')
      .select('*')
      .where({ job_id: jobId });

    return details.map(detail => ({
      ...detail,
      created_at: detail.created_at ? new Date(detail.created_at) : null,
      processed_at: detail.processed_at ? new Date(detail.processed_at) : null,
      updated_at: detail.updated_at ? new Date(detail.updated_at) : null
    }));
  }

  async getJobProgress(jobId: string) {
    const [header] = await this.knex('jobs')
      .select('*')
      .where({ job_id: jobId });

    const details = await this.getJobDetails(jobId);

    const metrics = {
      totalSteps: details.length,
      completedSteps: details.filter((d: { status: JobStatus }) => d.status === JobStatus.Completed).length,
      failedSteps: details.filter((d: { status: JobStatus }) => d.status === JobStatus.Failed).length,
      pendingSteps: details.filter((d: { status: JobStatus }) => d.status === JobStatus.Pending).length
    };

    return {
      header,
      details,
      metrics
    };
  }

  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!metadata?.tenantId) {
      throw new Error(`tenantId is required in metadata. Received: ${JSON.stringify(metadata)}`);
    }

    await this.knex('jobs')
      .where({ job_id: jobId, tenant: metadata.tenantId })
      .update({
        status,
        metadata,
        updated_at: this.knex.fn.now()
      });
  }
}

export type { JobService as default };