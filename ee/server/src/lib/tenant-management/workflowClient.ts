/**
 * Tenant Management Workflow Client
 *
 * Uses dynamic imports to avoid TypeScript errors when @temporalio/client
 * is not installed (e.g., in CI type checking).
 */

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'tenant-workflows';

// Inline type definitions to avoid importing from ee/temporal-workflows
export interface TenantCreationInput {
  tenantName: string;
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
  };
  companyName: string;
  clientName: string;
  licenseCount?: number;
  contractLine?: string;
  checkoutSessionId?: string;
}

export interface TenantCreationResult {
  success?: boolean;
  tenantId?: string;
  adminUserId?: string;
  error?: string;
}

export interface ResendWelcomeEmailInput {
  tenantId: string;
  userId?: string;
  triggeredBy: string;
  triggeredByEmail: string;
}

export interface ResendWelcomeEmailResult {
  success: boolean;
  email?: string;
  tenantName?: string;
  error?: string;
}

export interface TenantWorkflowClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<TenantCreationResult>;
  error?: string;
}

export interface ResendWelcomeEmailClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<ResendWelcomeEmailResult>;
  error?: string;
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
