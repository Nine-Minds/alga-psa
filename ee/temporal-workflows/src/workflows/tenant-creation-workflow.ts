import { 
  proxyActivities, 
  defineSignal, 
  defineQuery, 
  setHandler, 
  log, 
  condition,
  sleep,
  workflowInfo
} from '@temporalio/workflow';
import type {
  TenantCreationInput,
  TenantCreationResult,
  TenantCreationWorkflowState,
  TenantCreationCancelSignal,
  TenantCreationUpdateSignal,
  CreateTenantActivityResult,
  CreateAdminUserActivityResult,
  SetupTenantDataActivityResult,
  SendWelcomeEmailActivityInput,
  SendWelcomeEmailActivityResult
} from '../types/workflow-types.js';

// Define activity proxies with appropriate timeouts and retry policies
const activities = proxyActivities<{
  createTenant(input: { tenantName: string; email: string; companyName?: string }): Promise<CreateTenantActivityResult>;
  createAdminUser(input: {
    tenantId: string;
    firstName: string;
    lastName: string;
    email: string;
    companyId?: string;
  }): Promise<CreateAdminUserActivityResult>;
  setupTenantData(input: {
    tenantId: string;
    adminUserId: string;
    companyId?: string;
    billingPlan?: string;
  }): Promise<SetupTenantDataActivityResult>;
  run_onboarding_seeds(tenantId: string): Promise<{ success: boolean; seedsApplied: string[] }>;
  sendWelcomeEmail(input: SendWelcomeEmailActivityInput): Promise<SendWelcomeEmailActivityResult>;
  rollbackTenant(tenantId: string): Promise<void>;
  rollbackUser(userId: string, tenantId: string): Promise<void>;
  updateCheckoutSessionStatus(input: {
    checkoutSessionId: string;
    workflowStatus: 'pending' | 'started' | 'in_progress' | 'completed' | 'failed';
    workflowId?: string;
    error?: string;
  }): Promise<void>;
}>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '1s',
    maximumInterval: '30s',
    nonRetryableErrorTypes: ['ValidationError', 'DuplicateError'],
  },
});

// Define signals for workflow control
export const cancelWorkflowSignal = defineSignal<[TenantCreationCancelSignal]>('cancel');
export const updateWorkflowSignal = defineSignal<[TenantCreationUpdateSignal]>('update');

// Define queries for workflow state
export const getWorkflowStateQuery = defineQuery<TenantCreationWorkflowState>('getState');

/**
 * Main tenant creation workflow
 * 
 * This workflow orchestrates the creation of a new tenant, including:
 * 1. Creating the tenant record in the database
 * 2. Running onboarding seeds (roles, permissions, tax settings)
 * 3. Creating an admin user for the tenant
 * 4. Setting up initial tenant data (billing plans, default settings, etc.)
 * 5. Sending welcome email to the admin user
 * 
 * The workflow supports cancellation and provides detailed state tracking.
 */
export async function tenantCreationWorkflow(
  input: TenantCreationInput
): Promise<TenantCreationResult> {
  let workflowState: TenantCreationWorkflowState = {
    step: 'initializing',
    progress: 0,
  };

  let cancelled = false;
  let cancelReason = '';
  let tenantCreated = false;
  let userCreated = false;
  let temporaryPassword = '';
  let emailSent = false;

  // Set up signal handlers
  setHandler(cancelWorkflowSignal, (signal: TenantCreationCancelSignal) => {
    log.info('Received cancel signal', { reason: signal.reason, cancelledBy: signal.cancelledBy });
    cancelled = true;
    cancelReason = signal.reason;
    workflowState.step = 'failed';
    workflowState.error = `Cancelled: ${signal.reason}`;
  });

  setHandler(updateWorkflowSignal, (signal: TenantCreationUpdateSignal) => {
    log.info('Received update signal', { field: signal.field, value: signal.value });
    // Handle dynamic updates if needed
  });

  // Set up query handler
  setHandler(getWorkflowStateQuery, () => workflowState);

  try {
    log.info('Starting tenant creation workflow', { input });
    
    // Update checkout session status to in_progress if we have a sessionId
    if (input.checkoutSessionId) {
      try {
        await activities.updateCheckoutSessionStatus({
          checkoutSessionId: input.checkoutSessionId,
          workflowStatus: 'in_progress',
          workflowId: workflowInfo().workflowId,
        });
      } catch (statusError) {
        // Log but don't fail the workflow if status update fails
        log.warn('Failed to update checkout session status to in_progress', {
          error: statusError instanceof Error ? statusError.message : 'Unknown error',
          checkoutSessionId: input.checkoutSessionId,
        });
      }
    }
    
    // Step 1: Create tenant
    workflowState.step = 'creating_tenant';
    workflowState.progress = 10;
    
    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Creating tenant', { tenantName: input.tenantName });
    const tenantResult = await activities.createTenant({
      tenantName: input.tenantName,
      email: input.adminUser.email,
      companyName: input.companyName,
    });
    
    tenantCreated = true;
    workflowState.tenantId = tenantResult.tenantId;
    workflowState.companyId = tenantResult.companyId;
    workflowState.progress = 40;

    log.info('Tenant created successfully', { 
      tenantId: tenantResult.tenantId, 
      companyId: tenantResult.companyId 
    });

    // Step 2: Run onboarding seeds (roles, permissions, etc.)
    workflowState.step = 'running_onboarding_seeds';
    workflowState.progress = 40;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Running onboarding seeds for tenant');
    const seedsResult = await activities.run_onboarding_seeds(tenantResult.tenantId);
    
    workflowState.progress = 50;
    log.info('Onboarding seeds completed', { seedsApplied: seedsResult.seedsApplied });

    // Step 3: Create admin user (now with proper roles/permissions in place)
    workflowState.step = 'creating_admin_user';
    workflowState.progress = 60;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Creating admin user', { email: input.adminUser.email });
    const userResult = await activities.createAdminUser({
      tenantId: tenantResult.tenantId,
      firstName: input.adminUser.firstName,
      lastName: input.adminUser.lastName,
      email: input.adminUser.email,
      companyId: tenantResult.companyId,
    });

    userCreated = true;
    workflowState.adminUserId = userResult.userId;
    temporaryPassword = userResult.temporaryPassword;
    workflowState.progress = 70;

    log.info('Admin user created successfully', { 
      userId: userResult.userId, 
      roleId: userResult.roleId 
    });

    // Step 4: Setup tenant data
    workflowState.step = 'setting_up_data';
    workflowState.progress = 80;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Setting up tenant data');
    const setupResult = await activities.setupTenantData({
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      companyId: tenantResult.companyId,
      billingPlan: input.billingPlan,
    });

    workflowState.progress = 90;

    log.info('Tenant data setup completed', { setupSteps: setupResult.setupSteps });

    // Step 5: Send welcome email
    workflowState.step = 'sending_welcome_email';
    workflowState.progress = 95;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Sending welcome email to admin user');
    const emailResult = await activities.sendWelcomeEmail({
      tenantId: tenantResult.tenantId,
      tenantName: input.tenantName,
      adminUser: {
        userId: userResult.userId,
        firstName: input.adminUser.firstName,
        lastName: input.adminUser.lastName,
        email: input.adminUser.email,
      },
      temporaryPassword,
      companyName: input.companyName,
    });

    emailSent = emailResult.emailSent;
    workflowState.emailSent = emailSent;
    workflowState.progress = 100;
    workflowState.step = 'completed';

    log.info('Tenant creation completed successfully', {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      setupSteps: ['skipped_for_e2e_compatibility'],
      emailSent,
    });

    // Update checkout session status to completed if we have a sessionId
    if (input.checkoutSessionId) {
      try {
        await activities.updateCheckoutSessionStatus({
          checkoutSessionId: input.checkoutSessionId,
          workflowStatus: 'completed',
          workflowId: workflowInfo().workflowId,
        });
      } catch (statusError) {
        // Log but don't fail the workflow if status update fails
        log.warn('Failed to update checkout session status to completed', {
          error: statusError instanceof Error ? statusError.message : 'Unknown error',
          checkoutSessionId: input.checkoutSessionId,
        });
      }
    }

    return {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      companyId: tenantResult.companyId,
      temporaryPassword,
      emailSent,
      success: true,
      createdAt: new Date().toISOString(),
    };

  } catch (error) {
    workflowState.step = 'failed';
    workflowState.error = error instanceof Error ? error.message : 'Unknown error';
    
    log.error('Tenant creation workflow failed', { 
      error: workflowState.error,
      tenantCreated,
      userCreated 
    });

    // Update checkout session status to failed if we have a sessionId
    if (input.checkoutSessionId) {
      try {
        await activities.updateCheckoutSessionStatus({
          checkoutSessionId: input.checkoutSessionId,
          workflowStatus: 'failed',
          workflowId: workflowInfo().workflowId,
          error: workflowState.error,
        });
      } catch (statusError) {
        // Log but don't fail the workflow if status update fails
        log.warn('Failed to update checkout session status to failed', {
          error: statusError instanceof Error ? statusError.message : 'Unknown error',
          checkoutSessionId: input.checkoutSessionId,
        });
      }
    }

    // Rollback operations in reverse order
    try {
      if (userCreated && workflowState.adminUserId && workflowState.tenantId) {
        log.info('Rolling back user creation', { userId: workflowState.adminUserId });
        await activities.rollbackUser(workflowState.adminUserId, workflowState.tenantId);
      }

      if (tenantCreated && workflowState.tenantId) {
        log.info('Rolling back tenant creation', { tenantId: workflowState.tenantId });
        await activities.rollbackTenant(workflowState.tenantId);
      }
    } catch (rollbackError) {
      log.error('Rollback failed', { 
        rollbackError: rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'
      });
      // Continue with the original error - rollback failure shouldn't mask the original issue
    }

    // Re-throw the original error
    throw error;
  }
}

/**
 * Simple workflow for testing connectivity and basic functionality
 */
export async function healthCheckWorkflow(): Promise<{ status: string; timestamp: string }> {
  log.info('Health check workflow started');
  
  // Small delay to simulate work
  await sleep('100ms');
  
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };
}