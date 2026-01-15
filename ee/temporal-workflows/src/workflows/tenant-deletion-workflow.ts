import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  log,
  condition,
  sleep,
  workflowInfo,
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

// Activity proxies with appropriate timeouts
const {
  deactivateAllTenantUsers,
  reactivateTenantUsers,
  tagClientAsCanceled,
  removeClientCanceledTag,
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
  // Generate unique deletion ID
  const deletionId = crypto.randomUUID();
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

    // Step 1: Get tenant info
    state.step = 'getting_tenant_info';
    state.tenantName = await getTenantName(input.tenantId);
    log.info('Got tenant name', { tenantName: state.tenantName });

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

    // Step 4: Collect tenant statistics
    state.step = 'collecting_stats';
    log.info('Collecting tenant statistics');
    state.stats = await collectTenantStats(input.tenantId);
    log.info('Stats collected', { stats: state.stats });

    // Step 5: Record pending deletion in database
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
    });
    log.info('Pending deletion recorded');

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

  // Reactivate users
  log.info('Reactivating users');
  await reactivateTenantUsers(tenantId);

  // Remove canceled tag
  log.info('Removing Canceled tag');
  await removeClientCanceledTag(tenantId);

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
