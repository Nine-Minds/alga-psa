import {
  proxyActivities,
  defineQuery,
  setHandler,
  log,
  workflowInfo,
  uuid4,
} from '@temporalio/workflow';
import type * as activities from '../activities/tenant-export-activities';
import type {
  TenantExportWorkflowInput,
  TenantExportWorkflowResult,
  TenantExportWorkflowState,
} from '../types/tenant-export-types.js';

// Activity proxies with appropriate timeouts
// Export can take a while for large tenants
const { exportTenantData } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '5 seconds',
    maximumInterval: '1 minute',
    nonRetryableErrorTypes: ['ValidationError', 'TenantNotFoundError'],
  },
});

// Query to get current workflow state
export const getExportWorkflowStateQuery = defineQuery<TenantExportWorkflowState>('getExportState');

/**
 * Tenant Export Workflow
 *
 * This workflow handles exporting all tenant data:
 * 1. Validates the tenant exists
 * 2. Collects data from all tenant tables
 * 3. Uploads to S3 storage
 * 4. Generates a presigned download URL
 *
 * The workflow returns immediately with a workflow ID, allowing
 * the caller to poll for status via the query handler.
 */
export async function tenantExportWorkflow(
  input: TenantExportWorkflowInput
): Promise<TenantExportWorkflowResult> {
  // Generate unique export ID using Temporal's deterministic UUID
  const exportId = uuid4();
  const { workflowId } = workflowInfo();

  // Initialize workflow state
  let state: TenantExportWorkflowState = {
    step: 'initializing',
    status: 'pending',
    exportId,
    tenantId: input.tenantId,
    startedAt: new Date().toISOString(),
  };

  // Set up query handler for status polling
  setHandler(getExportWorkflowStateQuery, () => state);

  try {
    log.info('Starting tenant export workflow', {
      tenantId: input.tenantId,
      exportId,
      workflowId,
      requestedBy: input.requestedBy,
      reason: input.reason,
    });

    // Update state to in_progress
    state.status = 'in_progress';
    state.step = 'collecting_data';

    // Execute the export activity
    // This handles: validation, data collection, and S3 upload
    // Pass the workflow-generated exportId to ensure consistency
    const exportResult = await exportTenantData({
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      reason: input.reason,
      exportId,
    });

    if (!exportResult.success) {
      state.step = 'failed';
      state.status = 'failed';
      state.error = exportResult.error || 'Export failed';
      state.completedAt = new Date().toISOString();

      log.error('Tenant export failed', {
        tenantId: input.tenantId,
        exportId,
        error: state.error,
      });

      return {
        success: false,
        exportId,
        tenantId: input.tenantId,
        status: 'failed',
        error: state.error,
      };
    }

    // Update state with results
    state.step = 'completed';
    state.status = 'completed';
    state.bucket = exportResult.bucket;
    state.s3Key = exportResult.s3Key;
    state.fileSizeBytes = exportResult.fileSizeBytes;
    state.tableCount = exportResult.tableCount;
    state.recordCount = exportResult.recordCount;
    state.completedAt = new Date().toISOString();

    log.info('Tenant export completed successfully', {
      tenantId: input.tenantId,
      exportId,
      bucket: exportResult.bucket,
      s3Key: exportResult.s3Key,
      tableCount: exportResult.tableCount,
      recordCount: exportResult.recordCount,
      fileSizeBytes: exportResult.fileSizeBytes,
    });

    return {
      success: true,
      exportId,
      tenantId: input.tenantId,
      tenantName: state.tenantName,
      status: 'completed',
      bucket: exportResult.bucket,
      s3Key: exportResult.s3Key,
      fileSizeBytes: exportResult.fileSizeBytes,
      tableCount: exportResult.tableCount,
      recordCount: exportResult.recordCount,
    };

  } catch (error) {
    state.step = 'failed';
    state.status = 'failed';
    state.error = error instanceof Error ? error.message : 'Unknown error';
    state.completedAt = new Date().toISOString();

    log.error('Tenant export workflow failed with exception', {
      tenantId: input.tenantId,
      exportId,
      error: state.error,
    });

    return {
      success: false,
      exportId,
      tenantId: input.tenantId,
      status: 'failed',
      error: state.error,
    };
  }
}
