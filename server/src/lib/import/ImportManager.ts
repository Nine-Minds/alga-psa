import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getEventBus } from '../eventBus';
import { SourceRegistry } from './registry';
import { ImportContext } from './importer';
import logger from '@shared/core/logger';

export interface ImportJob {
  job_id: string;
  tenant: string;
  source_id: string;
  artifact_type: 'company' | 'contact';
  requested_by?: string;
  requested_at: Date;
  state: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR';
  summary?: any;
  workflow_execution_id?: string;
}

export interface ImportJobFilter {
  state?: string;
  source_id?: string;
  artifact_type?: string;
  limit?: number;
  offset?: number;
}

export class ImportManager {
  constructor(
    private knex: Knex,
    private tenant: string
  ) {}

  /**
   * Start a new import job
   */
  async startJob(
    sourceId: string,
    artifactType: 'company' | 'contact',
    userId?: string
  ): Promise<string> {
    const jobId = uuidv4();

    // Verify source exists and is enabled
    const registry = SourceRegistry.getInstance();
    if (!registry.isEnabled(sourceId) || !registry.supportsImport(sourceId)) {
      throw new Error(`Import source ${sourceId} is not available for import`);
    }

    // Create job record
    await this.knex('import_jobs').insert({
      job_id: jobId,
      tenant: this.tenant,
      source_id: sourceId,
      artifact_type: artifactType,
      requested_by: userId,
      requested_at: new Date(),
      state: 'PENDING'
    });

    // Emit workflow event to start the import
    const eventBus = getEventBus();
    await eventBus.publish({
      eventType: 'IMPORT_JOB_REQUESTED',
      payload: {
        jobId,
        sourceId,
        artifactType,
        requestedBy: userId,
        tenant: this.tenant,
        tenantId: this.tenant
      }
    });

    logger.info(`Import job ${jobId} created for ${sourceId} ${artifactType} import`);
    
    return jobId;
  }

  /**
   * Update job state
   */
  async updateJobState(
    jobId: string,
    state: 'RUNNING' | 'SUCCESS' | 'ERROR',
    summary?: any,
    workflowExecutionId?: string
  ): Promise<void> {
    const updates: any = {
      state,
      updated_at: new Date()
    };

    if (summary !== undefined) {
      updates.summary = summary;
    }

    if (workflowExecutionId) {
      updates.workflow_execution_id = workflowExecutionId;
    }

    await this.knex('import_jobs')
      .where({ job_id: jobId, tenant: this.tenant })
      .update(updates);

    // Emit appropriate event based on state
    const eventBus = getEventBus();
    if (state === 'RUNNING' && workflowExecutionId) {
      await eventBus.publish({
        eventType: 'IMPORT_JOB_STARTED',
        payload: {
          jobId,
          workflowExecutionId,
          tenant: this.tenant,
          tenantId: this.tenant
        }
      });
    } else if (state === 'SUCCESS') {
      await eventBus.publish({
        eventType: 'IMPORT_JOB_COMPLETED',
        payload: {
          jobId,
          totalImported: summary?.totalImported || 0,
          successCount: summary?.successCount || 0,
          errorCount: summary?.errorCount || 0,
          duration: summary?.duration || 0,
          tenant: this.tenant,
          tenantId: this.tenant
        }
      });
    } else if (state === 'ERROR') {
      await eventBus.publish({
        eventType: 'IMPORT_JOB_FAILED',
        payload: {
          jobId,
          error: summary?.error || 'Unknown error',
          processedCount: summary?.processedCount || 0,
          tenant: this.tenant,
          tenantId: this.tenant
        }
      });
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<ImportJob | null> {
    const job = await this.knex('import_jobs')
      .where({ job_id: jobId, tenant: this.tenant })
      .first();
    
    return job || null;
  }

  /**
   * List jobs with optional filters
   */
  async listJobs(filter: ImportJobFilter = {}): Promise<ImportJob[]> {
    let query = this.knex('import_jobs')
      .where({ tenant: this.tenant })
      .orderBy('requested_at', 'desc');

    if (filter.state) {
      query = query.where('state', filter.state);
    }

    if (filter.source_id) {
      query = query.where('source_id', filter.source_id);
    }

    if (filter.artifact_type) {
      query = query.where('artifact_type', filter.artifact_type);
    }

    if (filter.limit) {
      query = query.limit(filter.limit);
    }

    if (filter.offset) {
      query = query.offset(filter.offset);
    }

    return query;
  }

  /**
   * Get job summary statistics
   */
  async getJobSummary(jobId: string): Promise<any> {
    const job = await this.getJob(jobId);
    if (!job) {
      return null;
    }

    // Get counts from workflow execution summary
    return {
      job_id: job.job_id,
      source_id: job.source_id,
      artifact_type: job.artifact_type,
      state: job.state,
      requested_at: job.requested_at,
      requested_by: job.requested_by,
      workflow_execution_id: job.workflow_execution_id,
      summary: job.summary || {
        totalCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0
      }
    };
  }

  /**
   * Report progress for a job (called from workflow)
   */
  async reportProgress(
    jobId: string,
    processedCount: number,
    totalCount?: number,
    successCount?: number,
    errorCount?: number
  ): Promise<void> {
    const eventBus = getEventBus();
    await eventBus.publish({
      eventType: 'IMPORT_JOB_PROGRESS',
      payload: {
        jobId,
        processedCount,
        totalCount,
        successCount,
        errorCount,
        tenant: this.tenant,
        tenantId: this.tenant
      }
    });
  }

  /**
   * Report item processed (called from workflow)
   */
  async reportItemProcessed(
    jobId: string,
    externalId: string,
    algaEntityId: string | null,
    status: 'SUCCESS' | 'ERROR' | 'SKIPPED',
    message?: string
  ): Promise<void> {
    const eventBus = getEventBus();
    await eventBus.publish({
      eventType: 'IMPORT_ITEM_PROCESSED',
      payload: {
        jobId,
        externalId,
        algaEntityId,
        status,
        message,
        tenant: this.tenant,
        tenantId: this.tenant
      }
    });
  }
}