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
  SendWelcomeEmailActivityResult,
  CreatePortalUserActivityInput,
  CreatePortalUserActivityResult
} from '../types/workflow-types.js';

// Define activity proxies with appropriate timeouts and retry policies
const activities = proxyActivities<{
  createTenant(input: { tenantName: string; email: string; companyName?: string; licenseCount?: number }): Promise<CreateTenantActivityResult>;
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
  // Customer tracking activities
  createCustomerCompanyActivity(input: {
    tenantName: string;
    adminUserEmail: string;
  }): Promise<{ customerId: string }>;
  createCustomerContactActivity(input: {
    companyId: string;
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<{ contactId: string }>;
  tagCustomerCompanyActivity(input: {
    companyId: string;
    tagText: string;
  }): Promise<{ tagId: string }>;
  deleteCustomerCompanyActivity(input: {
    companyId: string;
  }): Promise<void>;
  deleteCustomerContactActivity(input: {
    contactId: string;
  }): Promise<void>;
  getManagementTenantId(): Promise<{ tenantId: string }>;
  createPortalUser(input: CreatePortalUserActivityInput): Promise<CreatePortalUserActivityResult>;
  rollbackPortalUser(userId: string, tenantId: string): Promise<void>;
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

// Separate proxy for nm-store callback with more aggressive retry policy
// This ensures the callback is retried with exponential backoff even if nm-store is temporarily down
const callbackActivities = proxyActivities<{
  callbackToNmStore(input: {
    sessionId: string;
    algaTenantId?: string;
    status: 'completed' | 'failed';
    error?: string;
  }): Promise<void>;
}>({
  startToCloseTimeout: '2m',
  retry: {
    maximumAttempts: 5,  // More attempts for callback
    backoffCoefficient: 2.0,
    initialInterval: '2s',  // Start with 2s
    maximumInterval: '60s',  // Allow up to 60s between retries
    nonRetryableErrorTypes: [],  // Retry all errors for callback
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
 * 5. Creating customer tracking records in nineminds tenant
 * 6. Sending welcome email to the admin user
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
  
  // Customer tracking variables
  let customerCompanyId: string | undefined;
  let customerContactId: string | undefined;
  let customerTagId: string | undefined;
  let portalUserId: string | undefined;
  let portalUserCreated = false;

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

    log.info('Creating tenant', { tenantName: input.tenantName, licenseCount: input.licenseCount });
    const tenantResult = await activities.createTenant({
      tenantName: input.tenantName,
      email: input.adminUser.email,
      companyName: input.companyName,
      licenseCount: input.licenseCount,
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

    // Step 5: Create customer tracking records (optional, non-blocking)
    // This tracks the new tenant as a customer in the nineminds management tenant
    try {
      workflowState.step = 'creating_customer_tracking';
      workflowState.progress = 85;

      if (cancelled) {
        throw new Error(`Workflow cancelled: ${cancelReason}`);
      }

      log.info('Creating customer tracking records in nineminds tenant');
      
      // Create customer company
      const customerCompanyResult = await activities.createCustomerCompanyActivity({
        tenantName: input.tenantName,
        adminUserEmail: input.adminUser.email,
      });
      customerCompanyId = customerCompanyResult.customerId;
      
      log.info('Customer company created', { customerId: customerCompanyId });

      // Create customer contact
      const customerContactResult = await activities.createCustomerContactActivity({
        companyId: customerCompanyId,
        firstName: input.adminUser.firstName,
        lastName: input.adminUser.lastName,
        email: input.adminUser.email,
      });
      customerContactId = customerContactResult.contactId;
      
      log.info('Customer contact created', { contactId: customerContactId });

      // Tag company as PSA Customer
      const tagResult = await activities.tagCustomerCompanyActivity({
        companyId: customerCompanyId,
        tagText: 'PSA Customer',
      });
      customerTagId = tagResult.tagId;
      
      log.info('Customer company tagged', { tagId: customerTagId });
      
      // Create portal user in Nine Minds tenant for the new customer
      // This allows them to access a client portal in the Nine Minds system
      if (customerContactId) {
        try {
          log.info('Creating portal user in Nine Minds tenant for customer');
          
          // Get the Nine Minds management tenant ID
          const { tenantId: ninemindsTenantId } = await activities.getManagementTenantId();
          
          const portalUserResult = await activities.createPortalUser({
            tenantId: ninemindsTenantId,
            email: input.adminUser.email,
            password: temporaryPassword, // Use the same password as the admin user
            contactId: customerContactId,
            companyId: customerCompanyId,
            firstName: input.adminUser.firstName,
            lastName: input.adminUser.lastName,
            isClientAdmin: true // Make them a client admin in the portal
          });
          
          portalUserId = portalUserResult.userId;
          portalUserCreated = true;
          
          log.info('Portal user created in Nine Minds tenant', { 
            portalUserId,
            roleId: portalUserResult.roleId,
            tenantId: ninemindsTenantId
          });
        } catch (portalUserError) {
          // Log the error but don't fail the workflow - portal user creation is optional
          log.error('Failed to create portal user in Nine Minds tenant (non-fatal)', {
            error: portalUserError instanceof Error ? portalUserError.message : 'Unknown error',
            email: input.adminUser.email,
          });
          // Continue with the workflow - this is not a critical failure
        }
      }
      
      workflowState.progress = 90;
    } catch (customerTrackingError) {
      // Log the error but don't fail the workflow - customer tracking is optional
      log.error('Failed to create customer tracking records (non-fatal)', {
        error: customerTrackingError instanceof Error ? customerTrackingError.message : 'Unknown error',
        tenantName: input.tenantName,
      });
      // Continue with the workflow - this is not a critical failure
    }

    // Step 6: Send welcome email
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
      
      // Callback to nm-store with the tenant ID
      // Use the separate callback proxy with enhanced retry policy
      try {
        await callbackActivities.callbackToNmStore({
          sessionId: input.checkoutSessionId,
          algaTenantId: tenantResult.tenantId,
          status: 'completed',
        });
        log.info('Successfully called back to nm-store with tenant ID', {
          sessionId: input.checkoutSessionId,
          tenantId: tenantResult.tenantId,
        });
      } catch (callbackError) {
        // Log but don't fail the workflow if callback fails after all retries
        log.warn('Failed to callback to nm-store after retries', {
          error: callbackError instanceof Error ? callbackError.message : 'Unknown error',
          checkoutSessionId: input.checkoutSessionId,
          tenantId: tenantResult.tenantId,
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
      // Include customer tracking IDs if they were created
      customerCompanyId,
      customerContactId,
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
      // Rollback portal user if created
      if (portalUserCreated && portalUserId) {
        try {
          // Get the Nine Minds tenant ID for rollback
          const { tenantId: ninemindsTenantId } = await activities.getManagementTenantId();
          log.info('Rolling back portal user', { userId: portalUserId, tenantId: ninemindsTenantId });
          await activities.rollbackPortalUser(portalUserId, ninemindsTenantId);
        } catch (portalRollbackError) {
          log.warn('Failed to rollback portal user (non-critical)', {
            error: portalRollbackError instanceof Error ? portalRollbackError.message : 'Unknown error'
          });
        }
      }
      
      // Rollback customer tracking if created
      if (customerContactId) {
        try {
          log.info('Rolling back customer contact', { contactId: customerContactId });
          await activities.deleteCustomerContactActivity({ contactId: customerContactId });
        } catch (customerRollbackError) {
          log.warn('Failed to rollback customer contact (non-critical)', { 
            error: customerRollbackError instanceof Error ? customerRollbackError.message : 'Unknown error'
          });
        }
      }
      
      if (customerCompanyId) {
        try {
          log.info('Rolling back customer company', { companyId: customerCompanyId });
          await activities.deleteCustomerCompanyActivity({ companyId: customerCompanyId });
        } catch (customerRollbackError) {
          log.warn('Failed to rollback customer company (non-critical)', { 
            error: customerRollbackError instanceof Error ? customerRollbackError.message : 'Unknown error'
          });
        }
      }

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