import { Client, Connection } from '@temporalio/client';
import { createLogger, format, transports } from 'winston';
import { tenantCreationWorkflow, healthCheckWorkflow, emailWebhookMaintenanceWorkflow, calendarWebhookMaintenanceWorkflow, resendWelcomeEmailWorkflow, tenantDeletionWorkflow } from './workflows/index';
import type {
  TenantCreationInput,
  TenantCreationResult,
  TenantCreationWorkflowState
} from './types/workflow-types.js';
import type { ResendWelcomeEmailInput, ResendWelcomeEmailResult } from './workflows/resend-welcome-email-workflow.js';
import type {
  TenantDeletionInput,
  TenantDeletionResult,
  TenantDeletionWorkflowState,
  ConfirmationType,
} from './types/tenant-deletion-types.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

/**
 * Configuration for the Temporal client
 */
interface ClientConfig {
  temporalAddress: string;
  temporalNamespace: string;
  taskQueue: string;
}

/**
 * Get client configuration from environment variables
 */
function getClientConfig(): ClientConfig {
  return {
    temporalAddress: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233',
    temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows',
  };
}

/**
 * Temporal client wrapper for tenant workflow operations
 */
export class TenantWorkflowClient {
  private client: Client;
  private config: ClientConfig;

  private constructor(client: Client, config: ClientConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Create a new client instance
   */
  static async create(): Promise<TenantWorkflowClient> {
    const config = getClientConfig();
    
    logger.info('Connecting to Temporal', { 
      address: config.temporalAddress,
      namespace: config.temporalNamespace 
    });

    const connection = await Connection.connect({
      address: config.temporalAddress,
    });

    const client = new Client({ 
      connection, 
      namespace: config.temporalNamespace 
    });

    logger.info('Connected to Temporal successfully');

    return new TenantWorkflowClient(client, config);
  }

  /**
   * Start a tenant creation workflow
   */
  async startTenantCreation(
    input: TenantCreationInput,
    workflowId?: string
  ): Promise<{
    workflowId: string;
    runId: string;
    result: Promise<TenantCreationResult>;
  }> {
    const finalWorkflowId = workflowId || `tenant-creation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('Starting tenant creation workflow', { 
      workflowId: finalWorkflowId,
      tenantName: input.tenantName,
      adminEmail: input.adminUser.email 
    });

    const handle = await this.client.workflow.start(tenantCreationWorkflow, {
      args: [input],
      taskQueue: this.config.taskQueue,
      workflowId: finalWorkflowId,
      // Set workflow timeout to 1 hour
      workflowExecutionTimeout: '1h',
      // Set workflow run timeout to 30 minutes
      workflowRunTimeout: '30m',
      // Set workflow task timeout to 1 minute
      workflowTaskTimeout: '1m',
    });

    logger.info('Tenant creation workflow started', {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: handle.result(),
    };
  }

  /**
   * Get the current state of a tenant creation workflow
   */
  async getTenantCreationState(workflowId: string): Promise<TenantCreationWorkflowState> {
    logger.info('Getting tenant creation workflow state', { workflowId });

    const handle = this.client.workflow.getHandle(workflowId);
    
    try {
      const state = await handle.query('getState');
      logger.info('Retrieved workflow state', { workflowId, state });
      return state as TenantCreationWorkflowState;
    } catch (error) {
      logger.error('Failed to get workflow state', { 
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Cancel a tenant creation workflow
   */
  async cancelTenantCreation(
    workflowId: string, 
    reason: string, 
    cancelledBy: string
  ): Promise<void> {
    logger.info('Cancelling tenant creation workflow', { 
      workflowId, 
      reason, 
      cancelledBy 
    });

    const handle = this.client.workflow.getHandle(workflowId);
    
    try {
      // Send cancel signal
      await handle.signal('cancel', { reason, cancelledBy });
      logger.info('Cancel signal sent to workflow', { workflowId });
    } catch (error) {
      logger.error('Failed to cancel workflow', { 
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Wait for a tenant creation workflow to complete
   */
  async waitForTenantCreation(workflowId: string): Promise<TenantCreationResult> {
    logger.info('Waiting for tenant creation workflow to complete', { workflowId });

    const handle = this.client.workflow.getHandle(workflowId);
    
    try {
      const result = await handle.result();
      logger.info('Tenant creation workflow completed', { workflowId, result });
      return result as TenantCreationResult;
    } catch (error) {
      logger.error('Tenant creation workflow failed', { 
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Run a health check workflow to verify connectivity
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    logger.info('Running health check workflow');

    const workflowId = `health-check-${Date.now()}`;
    
    try {
      const result = await this.client.workflow.execute(healthCheckWorkflow, {
        args: [],
        taskQueue: this.config.taskQueue,
        workflowId,
        workflowExecutionTimeout: '1m',
      });

      logger.info('Health check completed', { result });
      return result;
    } catch (error) {
      logger.error('Health check failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Start email webhook maintenance workflow
   */
  async startEmailWebhookMaintenance(options: { tenantId?: string; lookAheadMinutes?: number }): Promise<string> {
    const workflowId = `email-webhook-maintenance-${options.tenantId || 'global'}-${Date.now()}`;
    
    logger.info('Starting email webhook maintenance workflow', { 
      workflowId,
      ...options
    });

    const handle = await this.client.workflow.start(emailWebhookMaintenanceWorkflow, {
      args: [options],
      taskQueue: this.config.taskQueue,
      workflowId,
      workflowExecutionTimeout: '1h',
    });

    return handle.workflowId;
  }

  /**
   * Start calendar webhook maintenance workflow
   */
  async startCalendarWebhookMaintenance(options: { tenantId?: string; lookAheadMinutes?: number }): Promise<string> {
    const workflowId = `calendar-webhook-maintenance-${options.tenantId || 'global'}-${Date.now()}`;

    logger.info('Starting calendar webhook maintenance workflow', {
      workflowId,
      ...options
    });

    const handle = await this.client.workflow.start(calendarWebhookMaintenanceWorkflow, {
      args: [options],
      taskQueue: this.config.taskQueue,
      workflowId,
      workflowExecutionTimeout: '1h',
    });

    return handle.workflowId;
  }

  /**
   * Start resend welcome email workflow
   */
  async startResendWelcomeEmail(input: ResendWelcomeEmailInput): Promise<{
    workflowId: string;
    runId: string;
    result: Promise<ResendWelcomeEmailResult>;
  }> {
    const workflowId = `resend-welcome-email-${input.tenantId}-${Date.now()}`;

    logger.info('Starting resend welcome email workflow', {
      workflowId,
      tenantId: input.tenantId,
      userId: input.userId,
      triggeredBy: input.triggeredBy,
    });

    const handle = await this.client.workflow.start(resendWelcomeEmailWorkflow, {
      args: [input],
      taskQueue: this.config.taskQueue,
      workflowId,
      workflowExecutionTimeout: '5m',
    });

    logger.info('Resend welcome email workflow started', {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: handle.result(),
    };
  }

  /**
   * List recent tenant creation workflows
   */
  async listTenantCreationWorkflows(limit: number = 10): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: string;
    endTime?: string;
  }>> {
    logger.info('Listing tenant creation workflows', { limit });

    try {
      // Use the list API to get recent workflows
      const workflows = await this.client.workflow.list({
        query: `WorkflowType="tenantCreationWorkflow"`,
        pageSize: limit,
      });

      const results: Array<{
        workflowId: string;
        status: string;
        startTime: string;
        endTime?: string;
      }> = [];
      for await (const workflow of workflows) {
        results.push({
          workflowId: workflow.workflowId,
          status: workflow.status.name,
          startTime: workflow.startTime?.toISOString() || '',
          endTime: workflow.closeTime?.toISOString(),
        });
      }

      logger.info('Retrieved workflow list', { count: results.length });
      return results;
    } catch (error) {
      logger.error('Failed to list workflows', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ============================================
  // Tenant Deletion Workflow Methods
  // ============================================

  /**
   * Start a tenant deletion workflow
   */
  async startTenantDeletion(
    input: TenantDeletionInput,
    workflowId?: string
  ): Promise<{
    workflowId: string;
    runId: string;
    result: Promise<TenantDeletionResult>;
  }> {
    const finalWorkflowId = workflowId || `tenant-deletion-${input.tenantId}-${Date.now()}`;

    logger.info('Starting tenant deletion workflow', {
      workflowId: finalWorkflowId,
      tenantId: input.tenantId,
      triggerSource: input.triggerSource,
    });

    const handle = await this.client.workflow.start(tenantDeletionWorkflow, {
      args: [input],
      taskQueue: this.config.taskQueue,
      workflowId: finalWorkflowId,
      // Long timeout for 90-day potential wait
      workflowExecutionTimeout: '100d',
      workflowRunTimeout: '100d',
      workflowTaskTimeout: '1m',
    });

    logger.info('Tenant deletion workflow started', {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: handle.result(),
    };
  }

  /**
   * Get the current state of a tenant deletion workflow
   */
  async getTenantDeletionState(workflowId: string): Promise<TenantDeletionWorkflowState> {
    logger.info('Getting tenant deletion workflow state', { workflowId });

    const handle = this.client.workflow.getHandle(workflowId);

    try {
      const state = await handle.query('getState');
      logger.info('Retrieved tenant deletion workflow state', { workflowId, state });
      return state as TenantDeletionWorkflowState;
    } catch (error) {
      logger.error('Failed to get tenant deletion workflow state', {
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send confirmation signal to tenant deletion workflow
   */
  async confirmTenantDeletion(
    workflowId: string,
    type: ConfirmationType,
    confirmedBy: string
  ): Promise<void> {
    logger.info('Sending confirmation signal to tenant deletion workflow', {
      workflowId,
      type,
      confirmedBy,
    });

    const handle = this.client.workflow.getHandle(workflowId);

    try {
      await handle.signal('confirmDeletion', { type, confirmedBy });
      logger.info('Confirmation signal sent to tenant deletion workflow', { workflowId });
    } catch (error) {
      logger.error('Failed to send confirmation signal', {
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send rollback signal to tenant deletion workflow
   */
  async rollbackTenantDeletion(
    workflowId: string,
    reason: string,
    rolledBackBy: string
  ): Promise<void> {
    logger.info('Sending rollback signal to tenant deletion workflow', {
      workflowId,
      reason,
      rolledBackBy,
    });

    const handle = this.client.workflow.getHandle(workflowId);

    try {
      await handle.signal('rollbackDeletion', { reason, rolledBackBy });
      logger.info('Rollback signal sent to tenant deletion workflow', { workflowId });
    } catch (error) {
      logger.error('Failed to send rollback signal', {
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * List recent tenant deletion workflows
   */
  async listTenantDeletionWorkflows(limit: number = 10): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: string;
    endTime?: string;
  }>> {
    logger.info('Listing tenant deletion workflows', { limit });

    try {
      const workflows = await this.client.workflow.list({
        query: `WorkflowType="tenantDeletionWorkflow"`,
        pageSize: limit,
      });

      const results: Array<{
        workflowId: string;
        status: string;
        startTime: string;
        endTime?: string;
      }> = [];
      for await (const workflow of workflows) {
        results.push({
          workflowId: workflow.workflowId,
          status: workflow.status.name,
          startTime: workflow.startTime?.toISOString() || '',
          endTime: workflow.closeTime?.toISOString(),
        });
      }

      logger.info('Retrieved tenant deletion workflow list', { count: results.length });
      return results;
    } catch (error) {
      logger.error('Failed to list tenant deletion workflows', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    await this.client.connection.close();
    logger.info('Client connection closed');
  }
}

/**
 * Example usage function - can be called directly for testing
 */
async function exampleUsage(): Promise<void> {
  const client = await TenantWorkflowClient.create();

  try {
    // Health check
    logger.info('Running health check...');
    const healthResult = await client.healthCheck();
    logger.info('Health check result:', healthResult);

    // Example tenant creation
    const tenantInput: TenantCreationInput = {
      tenantName: 'Example Tenant',
      adminUser: {
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@example.com',
      },
      companyName: 'Example Client',
      clientName: 'Example Client',
      contractLine: 'Standard',
    };

    // Start workflow
    const { workflowId, result } = await client.startTenantCreation(tenantInput);
    logger.info('Workflow started:', { workflowId });

    // Wait for completion
    const finalResult = await result;
    logger.info('Workflow completed:', finalResult);

  } catch (error) {
    logger.error('Example usage failed:', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  } finally {
    await client.close();
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage().catch((error) => {
    console.error('Example failed:', error);
    process.exit(1);
  });
}

// TenantWorkflowClient already exported above
