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
import type { ProductUpgradeStatus } from '../actions/product-upgrade-actions';

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

export interface TenantProductUpgradeInput {
  tenantId: string;
  requestedByUserId: string;
}

export type TenantProductUpgradeStartClientResult =
  | {
      available: true;
      workflowId: string;
      runId?: string;
      alreadyRunning: boolean;
    }
  | { available: false; error: string };

export type TenantProductUpgradeStatusClientResult =
  | { available: true; data: ProductUpgradeStatus }
  | { available: false; error: string };

interface ProductUpgradeQueryPayload {
  currentStep: string | null;
  completedSteps: string[];
}

function isErrorNamed(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === name
  );
}

function isProductUpgradeQueryPayload(value: unknown): value is ProductUpgradeQueryPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.currentStep === null || typeof candidate.currentStep === 'string') &&
    Array.isArray(candidate.completedSteps) &&
    candidate.completedSteps.every((step): step is string => typeof step === 'string')
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

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

    const workflowName =
      input.productCode === 'algadesk'
        ? 'algadeskTenantCreationWorkflow'
        : 'tenantCreationWorkflow';

    const handle = await client.workflow.start(workflowName, {
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
  rolledBackBy: string,
  reactivation?: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionItemId?: string;
    stripePriceId: string;
    checkoutSessionId?: string;
    sendPasswordReset?: boolean;
  }
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
      await handle.signal('rollbackDeletion', { reason, rolledBackBy, reactivation });

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

export async function startTenantProductUpgradeWorkflow(
  input: TenantProductUpgradeInput
): Promise<TenantProductUpgradeStartClientResult> {
  let connection: { close: () => Promise<void> } | null = null;

  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;
    connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });
    const workflowId = `tenant-product-upgrade-${input.tenantId}`;

    try {
      const handle = await client.workflow.start('tenantProductUpgradeWorkflow', {
        args: [input],
        taskQueue,
        workflowId,
      });

      return {
        available: true,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        alreadyRunning: false,
      };
    } catch (error) {
      if (!isErrorNamed(error, 'WorkflowExecutionAlreadyStartedError')) {
        throw error;
      }

      const handle = client.workflow.getHandle(workflowId);
      const description = await handle.describe();
      const runId =
        typeof description?.runId === 'string'
          ? description.runId
          : typeof description?.execution?.runId === 'string'
            ? description.execution.runId
            : undefined;

      return {
        available: true,
        workflowId,
        runId,
        alreadyRunning: true,
      };
    }
  } catch (error) {
    return {
      available: false,
      error: errorMessage(error, 'Failed to start product upgrade workflow'),
    };
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

export async function getTenantProductUpgradeStatus(
  tenantId: string
): Promise<TenantProductUpgradeStatusClientResult> {
  let connection: { close: () => Promise<void> } | null = null;
  const workflowId = `tenant-product-upgrade-${tenantId}`;

  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { available: false, error: 'Temporal client not available' };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });
    const handle = client.workflow.getHandle(workflowId);

    let description: any;
    try {
      description = await handle.describe();
    } catch (error) {
      if (isErrorNamed(error, 'WorkflowNotFoundError')) {
        return { available: true, data: { state: 'idle' } };
      }
      throw error;
    }

    const status = description?.status?.name;
    if (status === 'COMPLETED') {
      return { available: true, data: { state: 'completed', workflowId } };
    }

    if (status !== 'RUNNING') {
      let failure = `Workflow ended with status ${
        typeof status === 'string' ? status.toLowerCase() : 'unknown'
      }`;
      try {
        await handle.result();
      } catch (error) {
        failure = errorMessage(error, failure);
      }

      return {
        available: true,
        data: { state: 'failed', workflowId, error: failure },
      };
    }

    const queryResult: unknown = await handle.query('productUpgradeStatus');
    if (!isProductUpgradeQueryPayload(queryResult)) {
      throw new Error('Invalid product upgrade workflow status payload');
    }

    return {
      available: true,
      data: {
        state: 'running',
        workflowId,
        currentStep: queryResult.currentStep,
        completedSteps: queryResult.completedSteps,
      },
    };
  } catch (error) {
    return {
      available: false,
      error: errorMessage(error, 'Failed to get product upgrade workflow status'),
    };
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
