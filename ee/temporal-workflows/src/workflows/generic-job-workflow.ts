import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  log,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type { JobStatus } from '../types/job.js';

/**
 * Input for the generic job workflow
 */
export interface GenericJobInput {
  /** The job ID in our database */
  jobId: string;
  /** The job type/name */
  jobName: string;
  /** The tenant ID */
  tenantId: string;
  /** The job data */
  data: Record<string, unknown>;
}

/**
 * Result from the generic job workflow
 */
export interface GenericJobResult {
  /** Whether the job succeeded */
  success: boolean;
  /** The job ID */
  jobId: string;
  /** Error message if failed */
  error?: string;
  /** Result data from the handler */
  result?: Record<string, unknown>;
  /** When the job completed */
  completedAt: string;
}

/**
 * State of the generic job workflow
 */
export interface GenericJobState {
  /** Current step in the workflow */
  step: 'initializing' | 'executing' | 'completed' | 'failed';
  /** Progress percentage (0-100) */
  progress: number;
  /** Error message if any */
  error?: string;
  /** Start time */
  startedAt?: string;
  /** Completion time */
  completedAt?: string;
}

/**
 * Signal to cancel the job
 */
export interface CancelJobSignal {
  reason: string;
  cancelledBy?: string;
}

/**
 * Signal to update job progress
 */
export interface UpdateProgressSignal {
  progress: number;
  message?: string;
}

// Define activity proxies
const activities = proxyActivities<{
  executeJobHandler(input: {
    jobId: string;
    jobName: string;
    tenantId: string;
    data: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string; result?: Record<string, unknown> }>;
  updateJobStatus(input: {
    jobId: string;
    tenantId: string;
    status: JobStatus;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  createJobDetail(input: {
    jobId: string;
    tenantId: string;
    stepName: string;
    status: JobStatus;
    metadata?: Record<string, unknown>;
  }): Promise<string>;
}>({
  startToCloseTimeout: '10m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

// Define signals
export const cancelJobSignal = defineSignal<[CancelJobSignal]>('cancelJob');
export const updateProgressSignal = defineSignal<[UpdateProgressSignal]>('updateProgress');

// Define queries
export const getJobStateQuery = defineQuery<GenericJobState>('getJobState');

/**
 * Generic job workflow that wraps any job handler
 *
 * This workflow provides Temporal's durability and observability
 * while executing jobs through the standard handler interface.
 * It allows any registered job handler to be executed as a Temporal
 * workflow, gaining features like:
 * - Automatic retries with configurable backoff
 * - Workflow state queries
 * - Cancellation via signals
 * - Progress tracking
 * - Comprehensive logging and tracing
 */
export async function genericJobWorkflow(
  input: GenericJobInput
): Promise<GenericJobResult> {
  const { jobId, jobName, tenantId, data } = input;

  // Initialize workflow state
  let state: GenericJobState = {
    step: 'initializing',
    progress: 0,
  };

  let cancelled = false;
  let cancelReason = '';

  // Set up signal handlers
  setHandler(cancelJobSignal, (signal: CancelJobSignal) => {
    log.info('Received cancel signal', {
      jobId,
      reason: signal.reason,
      cancelledBy: signal.cancelledBy,
    });
    cancelled = true;
    cancelReason = signal.reason;
    state.step = 'failed';
    state.error = `Cancelled: ${signal.reason}`;
  });

  setHandler(updateProgressSignal, (signal: UpdateProgressSignal) => {
    log.info('Received progress update', {
      jobId,
      progress: signal.progress,
      message: signal.message,
    });
    state.progress = signal.progress;
  });

  // Set up query handler
  setHandler(getJobStateQuery, () => state);

  try {
    log.info('Starting generic job workflow', {
      jobId,
      jobName,
      tenantId,
      workflowId: workflowInfo().workflowId,
    });

    state.startedAt = new Date().toISOString();

    // Check for cancellation
    if (cancelled) {
      throw new Error(`Job cancelled: ${cancelReason}`);
    }

    // Update job status to processing
    state.step = 'executing';
    state.progress = 10;

    await activities.updateJobStatus({
      jobId,
      tenantId,
      status: 'processing' as JobStatus,
      metadata: { workflowId: workflowInfo().workflowId },
    });

    // Create a job detail for the execution start
    await activities.createJobDetail({
      jobId,
      tenantId,
      stepName: 'execution_started',
      status: 'processing',
      metadata: {
        jobName,
        workflowId: workflowInfo().workflowId,
        startedAt: state.startedAt,
      },
    });

    state.progress = 20;

    // Check for cancellation again
    if (cancelled) {
      throw new Error(`Job cancelled: ${cancelReason}`);
    }

    // Execute the job handler
    log.info('Executing job handler', { jobId, jobName });

    const result = await activities.executeJobHandler({
      jobId,
      jobName,
      tenantId,
      data,
    });

    state.progress = 90;

    if (!result.success) {
      throw new Error(result.error || 'Job handler returned failure');
    }

    // Update job status to completed
    state.step = 'completed';
    state.progress = 100;
    state.completedAt = new Date().toISOString();

    await activities.updateJobStatus({
      jobId,
      tenantId,
      status: 'completed' as JobStatus,
      metadata: {
        workflowId: workflowInfo().workflowId,
        completedAt: state.completedAt,
      },
    });

    // Create a job detail for the execution completion
    await activities.createJobDetail({
      jobId,
      tenantId,
      stepName: 'execution_completed',
      status: 'completed',
      metadata: {
        jobName,
        workflowId: workflowInfo().workflowId,
        completedAt: state.completedAt,
        result: result.result,
      },
    });

    log.info('Generic job workflow completed successfully', {
      jobId,
      jobName,
      duration: Date.now() - new Date(state.startedAt!).getTime(),
    });

    return {
      success: true,
      jobId,
      result: result.result,
      completedAt: state.completedAt,
    };
  } catch (error) {
    state.step = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    state.completedAt = new Date().toISOString();

    log.error('Generic job workflow failed', {
      jobId,
      jobName,
      error: state.error,
    });

    // Update job status to failed
    try {
      await activities.updateJobStatus({
        jobId,
        tenantId,
        status: 'failed' as JobStatus,
        error: state.error,
        metadata: {
          workflowId: workflowInfo().workflowId,
          failedAt: state.completedAt,
        },
      });

      // Create a job detail for the failure
      await activities.createJobDetail({
        jobId,
        tenantId,
        stepName: 'execution_failed',
        status: 'failed',
        metadata: {
          jobName,
          workflowId: workflowInfo().workflowId,
          error: state.error,
          failedAt: state.completedAt,
        },
      });
    } catch (updateError) {
      log.error('Failed to update job status on error', {
        jobId,
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    // Return a terminal failure result so schedule-driven workflows close cleanly.
    // Re-throwing a plain Error here causes workflow-task failures and can leave
    // the schedule run wedged in Running state.
    return {
      success: false,
      jobId,
      error: state.error,
      completedAt: state.completedAt,
    };
  }
}
