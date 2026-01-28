import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  log,
  condition,
  sleep,
  workflowInfo,
  uuid4,
  executeChild,
} from '@temporalio/workflow';
import type * as activities from '../activities/tenant-deletion-activities';
import type {
  TenantDeletionInput,
  TenantDeletionResult,
  TenantDeletionWorkflowState,
  TenantStats,
  ConfirmDeletionSignal,
  RollbackDeletionSignal,
  ConfirmationType,
} from '../types/tenant-deletion-types.js';
import type {
  TenantExportWorkflowInput,
  TenantExportWorkflowResult,
} from '../types/tenant-export-types.js';
import { tenantExportWorkflow } from './tenant-export-workflow.js';

// Activity proxies with appropriate timeouts
const {
  validateTenantDeletion,
  deactivateAllTenantUsers,
  reactivateTenantUsers,
  tagClientAsCanceled,
  removeClientCanceledTag,
  deactivateMasterTenantClient,
  reactivateMasterTenantClient,
  collectTenantStats,
  getTenantName,
  recordPendingDeletion,
  updateDeletionStatus,
  deleteTenantData,
  cancelTenantStripeSubscription,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
    nonRetryableErrorTypes: ['ValidationError'],
  },
});

// Signals for workflow control
export const confirmDeletionSignal = defineSignal<[ConfirmDeletionSignal]>('confirmDeletion');
export const rollbackDeletionSignal = defineSignal<[RollbackDeletionSignal]>('rollbackDeletion');

// Query to get current workflow state
export const getDeletionWorkflowStateQuery = defineQuery<TenantDeletionWorkflowState>('getDeletionState');

// Time constants
const DAYS_90_MS = 90 * 24 * 60 * 60 * 1000;
const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Tenant Deletion Workflow
 *
 * This workflow handles the complete tenant deletion lifecycle:
 * 1. Deactivates all tenant users
 * 2. Tags the tenant's client as 'Canceled' in the management tenant
 * 3. Collects tenant statistics for audit purposes
 * 4. Records the pending deletion in the database
 * 5. Waits for a confirmation signal (or 90 days timeout)
 * 6. On confirmation: waits for specified delay then deletes tenant data
 * 7. On rollback: reactivates users and removes canceled tag
 * 8. If no signal after 90 days: auto-deletes
 */
export async function tenantDeletionWorkflow(
  input: TenantDeletionInput
): Promise<TenantDeletionResult> {
  // Generate unique deletion ID using Temporal's deterministic UUID
  const deletionId = uuid4();
  const { workflowId, firstExecutionRunId } = workflowInfo();

  // Initialize workflow state
  let state: TenantDeletionWorkflowState = {
    step: 'initializing',
    status: 'pending',
    deletionId,
    tenantId: input.tenantId,
  };

  // Signal storage
  let confirmationSignal: ConfirmDeletionSignal | null = null;
  let rollbackSignal: RollbackDeletionSignal | null = null;

  // Set up signal handlers
  setHandler(confirmDeletionSignal, (signal) => {
    log.info('Received confirmation signal', { ...signal });
    confirmationSignal = signal;
  });

  setHandler(rollbackDeletionSignal, (signal) => {
    log.info('Received rollback signal', { ...signal });
    rollbackSignal = signal;
  });

  // Set up query handler
  setHandler(getDeletionWorkflowStateQuery, () => state);

  try {
    log.info('Starting tenant deletion workflow', {
      tenantId: input.tenantId,
      triggerSource: input.triggerSource,
      deletionId,
    });

    // Step 0: CRITICAL - Validate tenant can be deleted (not master tenant)
    state.step = 'validating_tenant';
    log.info('Validating tenant deletion is allowed', { tenantId: input.tenantId });
    const validation = await validateTenantDeletion(input.tenantId);

    if (!validation.valid) {
      log.error('Tenant deletion validation failed', {
        tenantId: input.tenantId,
        isMasterTenant: validation.isMasterTenant,
        error: validation.error,
      });
      throw new Error(validation.error || 'Tenant deletion validation failed');
    }

    log.info('Tenant deletion validation passed', {
      tenantId: input.tenantId,
      managementTenantId: validation.managementTenantId,
    });

    // Step 1: Get tenant info
    state.step = 'getting_tenant_info';
    state.tenantName = await getTenantName(input.tenantId);
    log.info('Got tenant name', { tenantName: state.tenantName });

    // Step 1.5: Export tenant data BEFORE any modifications (as child workflow)
    state.step = 'exporting_data';
    log.info('Starting tenant data export workflow before deletion', { tenantId: input.tenantId });

    try {
      const exportInput: TenantExportWorkflowInput = {
        tenantId: input.tenantId,
        requestedBy: input.triggeredBy || 'tenant-deletion-workflow',
        reason: `Pre-deletion export for deletion ID: ${deletionId}`,
      };

      // Execute export as child workflow - allows longer timeout and independent tracking
      const exportResult = await executeChild(tenantExportWorkflow, {
        workflowId: `tenant-export-deletion-${deletionId}`,
        args: [exportInput],
        // Allow up to 1 hour for large tenant exports
        workflowExecutionTimeout: '1 hour',
      });

      if (exportResult.success) {
        state.exportId = exportResult.exportId;
        state.exportBucket = exportResult.bucket;
        state.exportS3Key = exportResult.s3Key;
        state.exportFileSizeBytes = exportResult.fileSizeBytes;
        log.info('Tenant data export workflow completed successfully', {
          exportId: exportResult.exportId,
          s3Key: exportResult.s3Key,
          fileSizeBytes: exportResult.fileSizeBytes,
          tableCount: exportResult.tableCount,
          recordCount: exportResult.recordCount,
        });
      } else {
        // Export failed, but we continue - log warning
        log.warn('Tenant data export workflow failed (continuing with deletion)', {
          error: exportResult.error,
        });
      }
    } catch (exportError) {
      // Export workflow failed entirely - log but continue with deletion
      log.warn('Tenant data export workflow threw error (continuing with deletion)', {
        error: exportError instanceof Error ? exportError.message : 'Unknown error',
      });
    }

    // Step 2: Deactivate all users
    state.step = 'deactivating_users';
    log.info('Deactivating all users for tenant', { tenantId: input.tenantId });
    const { deactivatedCount } = await deactivateAllTenantUsers(input.tenantId);
    log.info('Users deactivated', { deactivatedCount });

    // Step 2.5: Cancel Stripe subscription if triggered from extension/manual (not from Stripe webhook)
    // When triggered by Stripe webhook, the subscription is already canceled
    if (input.triggerSource !== 'stripe_webhook') {
      state.step = 'canceling_stripe_subscription';
      log.info('Canceling Stripe subscription (triggered from extension/manual)', { tenantId: input.tenantId });
      const cancelResult = await cancelTenantStripeSubscription(input.tenantId);
      if (cancelResult.canceled) {
        log.info('Stripe subscription canceled', { subscriptionId: cancelResult.subscriptionId });
      } else if (cancelResult.error) {
        log.warn('Failed to cancel Stripe subscription', { error: cancelResult.error });
      } else {
        log.info('No active Stripe subscription to cancel');
      }
    }

    // Step 3: Tag client as 'Canceled' in management tenant
    state.step = 'tagging_client';
    log.info('Tagging client as Canceled');
    await tagClientAsCanceled(input.tenantId);

    // Step 3.5: Deactivate client and contacts in management tenant
    state.step = 'deactivating_master_client';
    log.info('Deactivating client and contacts in master tenant');
    const deactivateResult = await deactivateMasterTenantClient(input.tenantId);
    if (deactivateResult.clientDeactivated) {
      log.info('Master tenant client deactivated', {
        clientId: deactivateResult.clientId,
        contactsDeactivated: deactivateResult.contactsDeactivated,
      });
    } else {
      log.warn('Could not deactivate master tenant client (may not exist)');
    }

    // Step 4: Collect tenant statistics
    state.step = 'collecting_stats';
    log.info('Collecting tenant statistics');
    state.stats = await collectTenantStats(input.tenantId);
    log.info('Stats collected', { stats: state.stats });

    // Step 5: Record pending deletion in database (including export info)
    state.step = 'recording_pending_deletion';
    await recordPendingDeletion({
      deletionId,
      tenantId: input.tenantId,
      triggerSource: input.triggerSource,
      triggeredBy: input.triggeredBy,
      subscriptionExternalId: input.subscriptionExternalId,
      workflowId,
      workflowRunId: firstExecutionRunId,
      stats: state.stats,
      exportId: state.exportId,
      exportBucket: state.exportBucket,
      exportS3Key: state.exportS3Key,
      exportFileSizeBytes: state.exportFileSizeBytes,
    });
    log.info('Pending deletion recorded', {
      exportId: state.exportId,
      exportS3Key: state.exportS3Key,
    });

    // Step 6: Wait for confirmation signal or 90 days timeout
    state.step = 'awaiting_confirmation';
    state.status = 'awaiting_confirmation';
    await updateDeletionStatus({ deletionId, status: 'awaiting_confirmation' });
    log.info('Waiting for confirmation signal (or 90 days timeout)');

    // Wait for either signal or timeout
    const signalReceived = await condition(
      () => confirmationSignal !== null || rollbackSignal !== null,
      DAYS_90_MS
    );

    // Step 7: Handle rollback signal
    if (rollbackSignal) {
      return await handleRollback(
        state,
        rollbackSignal,
        deletionId,
        input.tenantId
      );
    }

    // Step 8: Determine deletion timing
    // Re-capture signal reference to help TypeScript with control flow
    const confirmedSignal = confirmationSignal as ConfirmDeletionSignal | null;
    let deletionDelay = 0;
    let confirmationTypeStr: string = 'auto_90_days';

    if (confirmedSignal) {
      state.confirmationType = confirmedSignal.type;
      state.confirmedBy = confirmedSignal.confirmedBy;
      state.confirmedAt = new Date().toISOString();
      confirmationTypeStr = confirmedSignal.type;

      switch (confirmedSignal.type) {
        case 'immediate':
          deletionDelay = 0;
          break;
        case '30_days':
          deletionDelay = DAYS_30_MS;
          break;
        case '90_days':
          deletionDelay = DAYS_90_MS;
          break;
      }

      log.info('Confirmation received', {
        type: confirmedSignal.type,
        confirmedBy: confirmedSignal.confirmedBy,
        deletionDelay: deletionDelay / (24 * 60 * 60 * 1000) + ' days',
      });
    } else {
      log.info('No confirmation signal received, auto-deleting after 90 days timeout');
    }

    // Update status to confirmed
    state.status = 'confirmed';
    const deletionDate = new Date(Date.now() + deletionDelay);
    state.deletionScheduledFor = deletionDate.toISOString();

    await updateDeletionStatus({
      deletionId,
      status: 'confirmed',
      confirmationType: confirmationTypeStr,
      confirmedBy: confirmedSignal?.confirmedBy,
      deletionScheduledFor: deletionDate,
    });

    // Step 9: Wait for deletion delay (if any)
    if (deletionDelay > 0) {
      state.step = 'waiting_for_deletion_date';
      log.info('Waiting for deletion date', { deletionDate: state.deletionScheduledFor });

      // During the wait, check for rollback signal
      const rollbackDuringWait = await condition(
        () => rollbackSignal !== null,
        deletionDelay
      );

      // Handle late rollback
      if (rollbackSignal) {
        return await handleRollback(
          state,
          rollbackSignal,
          deletionId,
          input.tenantId
        );
      }
    }

    // Step 10: Execute tenant deletion
    state.step = 'deleting_tenant_data';
    state.status = 'deleting';
    await updateDeletionStatus({ deletionId, status: 'deleting' });

    log.info('Executing tenant deletion', { tenantId: input.tenantId });
    const deleteResult = await deleteTenantData(input.tenantId, deletionId);

    if (!deleteResult.success) {
      state.status = 'failed';
      state.error = deleteResult.error;
      await updateDeletionStatus({
        deletionId,
        status: 'failed',
        error: deleteResult.error,
      });
      throw new Error(`Deletion failed: ${deleteResult.error}`);
    }

    // Step 11: Complete successfully
    state.step = 'completed';
    state.status = 'deleted';
    await updateDeletionStatus({ deletionId, status: 'deleted' });

    log.info('Tenant deletion completed successfully', {
      tenantId: input.tenantId,
      deletionId,
    });

    return {
      success: true,
      deletionId,
      tenantId: input.tenantId,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
    };

  } catch (error) {
    state.step = 'failed';
    state.status = 'failed';
    state.error = error instanceof Error ? error.message : 'Unknown error';

    log.error('Tenant deletion workflow failed', { error: state.error });

    try {
      await updateDeletionStatus({
        deletionId,
        status: 'failed',
        error: state.error,
      });
    } catch (updateError) {
      log.error('Failed to update deletion status after error', {
        error: updateError instanceof Error ? updateError.message : 'Unknown error',
      });
    }

    throw error;
  }
}

/**
 * Handle rollback of tenant deletion
 */
async function handleRollback(
  state: TenantDeletionWorkflowState,
  rollbackSignal: RollbackDeletionSignal,
  deletionId: string,
  tenantId: string
): Promise<TenantDeletionResult> {
  state.step = 'rolling_back';
  state.status = 'rolled_back';
  state.rollbackReason = rollbackSignal.reason;
  state.rolledBackBy = rollbackSignal.rolledBackBy;

  log.info('Rolling back deletion', {
    reason: rollbackSignal.reason,
    rolledBackBy: rollbackSignal.rolledBackBy,
  });

  // Reactivate users in the deleted tenant
  log.info('Reactivating users');
  await reactivateTenantUsers(tenantId);

  // Remove canceled tag from client in master tenant
  log.info('Removing Canceled tag');
  await removeClientCanceledTag(tenantId);

  // Reactivate client and contacts in master tenant
  log.info('Reactivating client and contacts in master tenant');
  await reactivateMasterTenantClient(tenantId);

  // Update database
  await updateDeletionStatus({
    deletionId,
    status: 'rolled_back',
    rollbackReason: rollbackSignal.reason,
    rolledBackBy: rollbackSignal.rolledBackBy,
  });

  log.info('Rollback completed', { tenantId, deletionId });

  return {
    success: true,
    deletionId,
    tenantId,
    status: 'rolled_back',
  };
}
