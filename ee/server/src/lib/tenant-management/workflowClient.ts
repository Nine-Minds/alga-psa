/**
 * Tenant Management Workflow Client
 *
 * Uses dynamic imports to avoid TypeScript errors when @temporalio/client
 * is not installed (e.g., in CI type checking).
 */

// Import all tenant workflow types from EE interfaces
import type {
  TenantCreationInput,
  TenantCreationResult,
  TenantWorkflowClientResult,
  ResendWelcomeEmailInput,
  ResendWelcomeEmailResult,
  ResendWelcomeEmailClientResult,
  TenantDeletionInput,
  TenantDeletionResult,
  TenantDeletionWorkflowState,
  TenantDeletionClientResult,
  ConfirmationType,
  SignalResult,
  QueryResult,
  TenantExportInput,
  TenantExportResult,
  TenantExportWorkflowState,
  TenantExportClientResult,
} from '@ee/interfaces/tenant.interfaces';

// Re-export for consumers
export type {
  TenantCreationInput,
  TenantCreationResult,
  TenantWorkflowClientResult,
  ResendWelcomeEmailInput,
  ResendWelcomeEmailResult,
  ResendWelcomeEmailClientResult,
  TenantDeletionInput,
  TenantDeletionResult,
  TenantDeletionWorkflowState,
  TenantDeletionClientResult,
  ConfirmationType,
  SignalResult,
  QueryResult,
  TenantExportInput,
  TenantExportResult,
  TenantExportWorkflowState,
  TenantExportClientResult,
};

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'tenant-workflows';

/**
 * Start a tenant creation workflow via Temporal.
 * Returns { available: false } if Temporal client is not available.
 */
export async function startTenantCreationWorkflow(
  input: TenantCreationInput
): Promise<TenantWorkflowClientResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    const workflowId = `tenant-creation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const handle = await client.workflow.start('tenantCreationWorkflow', {
      args: [input],
      taskQueue,
      workflowId,
      workflowExecutionTimeout: '1h',
      workflowRunTimeout: '30m',
      workflowTaskTimeout: '1m',
    });

    // Create a result promise that also closes the connection
    const resultPromise = handle.result().finally(async () => {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    });

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: resultPromise,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Start a resend welcome email workflow via Temporal.
 * Returns { available: false } if Temporal client is not available.
 */
export async function startResendWelcomeEmailWorkflow(
  input: ResendWelcomeEmailInput
): Promise<ResendWelcomeEmailClientResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    const workflowId = `resend-welcome-email-${input.tenantId}-${Date.now()}`;

    const handle = await client.workflow.start('resendWelcomeEmailWorkflow', {
      args: [input],
      taskQueue,
      workflowId,
      workflowExecutionTimeout: '5m',
    });

    // Create a result promise that also closes the connection
    const resultPromise = handle.result().finally(async () => {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    });

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: resultPromise,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Start a tenant deletion workflow via Temporal.
 * Returns { available: false } if Temporal client is not available.
 */
export async function startTenantDeletionWorkflow(
  input: TenantDeletionInput
): Promise<TenantDeletionClientResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    const workflowId = `tenant-deletion-${input.tenantId}-${Date.now()}`;

    const handle = await client.workflow.start('tenantDeletionWorkflow', {
      args: [input],
      taskQueue,
      workflowId,
      // Long timeout for 90-day potential wait
      workflowExecutionTimeout: '100d',
      workflowRunTimeout: '100d',
      workflowTaskTimeout: '1m',
    });

    // Note: We don't wait for result here since this is a long-running workflow
    // The connection stays open but we don't block

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      // Don't return result promise for long-running workflows
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the state of a tenant deletion workflow.
 */
export async function getTenantDeletionState(
  workflowId: string
): Promise<QueryResult<TenantDeletionWorkflowState>> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    try {
      const handle = client.workflow.getHandle(workflowId);
      const state = await handle.query('getState');

      return {
        available: true,
        data: state as TenantDeletionWorkflowState,
      };
    } finally {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send confirmation signal to a tenant deletion workflow.
 */
export async function confirmTenantDeletion(
  workflowId: string,
  type: ConfirmationType,
  confirmedBy: string
): Promise<SignalResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    try {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal('confirmDeletion', { type, confirmedBy });

      return {
        available: true,
        success: true,
      };
    } finally {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send rollback signal to a tenant deletion workflow.
 */
export async function rollbackTenantDeletion(
  workflowId: string,
  reason: string,
  rolledBackBy: string
): Promise<SignalResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    try {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal('rollbackDeletion', { reason, rolledBackBy });

      return {
        available: true,
        success: true,
      };
    } finally {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Tenant Export Workflow Functions
// ============================================================================

/**
 * Start a tenant export workflow via Temporal.
 * Returns { available: false } if Temporal client is not available.
 */
export async function startTenantExportWorkflow(
  input: TenantExportInput
): Promise<TenantExportClientResult> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    const workflowId = `tenant-export-${input.tenantId}-${Date.now()}`;

    const handle = await client.workflow.start('tenantExportWorkflow', {
      args: [input],
      taskQueue,
      workflowId,
      // Export should complete within 1 hour
      workflowExecutionTimeout: '1h',
      workflowRunTimeout: '45m',
      workflowTaskTimeout: '1m',
    });

    // Create a result promise that also closes the connection
    const resultPromise = handle.result().finally(async () => {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    });

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: resultPromise,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the state of a tenant export workflow.
 */
export async function getTenantExportState(
  workflowId: string
): Promise<QueryResult<TenantExportWorkflowState>> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });

    try {
      const handle = client.workflow.getHandle(workflowId);
      const state = await handle.query('getExportState');

      return {
        available: true,
        data: state as TenantExportWorkflowState,
      };
    } finally {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
