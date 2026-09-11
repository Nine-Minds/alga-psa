import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  startChild,
  ParentClosePolicy,
  log,
} from '@temporalio/workflow';
import { trialPaymentReminderWorkflow } from '../trial-payment-reminder-workflow.js';
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
  CreatePortalUserActivityResult,
  TenantBillingAddress,
} from '../../types/workflow-types.js';

const activities = proxyActivities<{
  createTenant(input: {
    tenantName: string;
    email: string;
    tenantId?: string;
    companyName?: string;
    clientName?: string;
    licenseCount?: number;
    billingSource?: 'stripe' | 'apple_iap' | 'manual';
    plan?: 'solo' | 'pro';
    productCode?: 'psa' | 'algadesk';
    appleIap?: {
      originalTransactionId: string;
      productId: string;
      bundleId: string;
      environment: 'Production' | 'Sandbox';
      appAccountToken?: string;
      latestTransactionId?: string;
      expiresAt?: string;
      originalPurchaseAt?: string;
    };
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeSubscriptionItemId?: string;
    stripePriceId?: string;
    stripeBaseItemId?: string;
    stripeBasePriceId?: string;
    billingAddress?: TenantBillingAddress;
    addons?: string[];
  }): Promise<CreateTenantActivityResult>;
  createAdminUser(input: {
    tenantId: string;
    firstName: string;
    lastName: string;
    email: string;
    clientId?: string;
    password?: string;
  }): Promise<CreateAdminUserActivityResult>;
  setupTenantData(input: {
    tenantId: string;
    adminUserId: string;
    clientId?: string;
    contractLine?: string;
    emailProvider?: 'smtp' | 'resend';
  }): Promise<SetupTenantDataActivityResult>;
  run_onboarding_seeds(input: {
    tenantId: string;
    productCode?: 'psa' | 'algadesk';
  }): Promise<{ success: boolean; seedsApplied: string[] }>;
  sendWelcomeEmail(input: SendWelcomeEmailActivityInput): Promise<SendWelcomeEmailActivityResult>;
  rollbackTenant(tenantId: string): Promise<void>;
  rollbackUser(userId: string, tenantId: string): Promise<void>;
  createCustomerClientActivity(input: {
    tenantName: string;
    adminUserEmail: string;
  }): Promise<{ customerId: string; reused: boolean }>;
  createCustomerContactActivity(input: {
    clientId: string;
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<{ contactId: string; reused: boolean }>;
  tagCustomerClientActivity(input: {
    clientId: string;
    tagText: string;
  }): Promise<{ tagId: string }>;
  deleteCustomerClientActivity(input: {
    clientId: string;
  }): Promise<void>;
  deleteCustomerContactActivity(input: {
    contactId: string;
  }): Promise<void>;
  getManagementTenantId(): Promise<{ tenantId: string }>;
  createPortalUser(input: CreatePortalUserActivityInput): Promise<CreatePortalUserActivityResult>;
  rollbackPortalUser(userId: string, tenantId: string): Promise<void>;
  fetchStripeDetailsFromCheckout(input: {
    checkoutSessionId: string;
  }): Promise<{
    stripeCustomerId: string;
    stripeSubscriptionId?: string;
    stripeSubscriptionItemId?: string;
    stripePriceId?: string;
    stripeBaseItemId?: string;
    stripeBasePriceId?: string;
    licenseCount?: number;
    billingAddress?: TenantBillingAddress;
  }>;
}>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '1s',
    maximumInterval: '30s',
    nonRetryableErrorTypes: [
      'ValidationError',
      'DuplicateError',
      'AmbiguousCustomerMatchError',
      'ContactEmailConflictError',
    ],
  },
});

export const cancelWorkflowSignal = defineSignal<[TenantCreationCancelSignal]>('cancel');
export const updateWorkflowSignal = defineSignal<[TenantCreationUpdateSignal]>('update');
export const getWorkflowStateQuery = defineQuery<TenantCreationWorkflowState>('getState');

export interface TenantCreationOrchestrationConfig {
  customerTag: string;
}

/**
 * Unwrap Temporal's activity-failure wrapper so state/logs carry the activity's
 * real reason instead of the generic "Activity task failed". Pure and
 * deterministic, so it is safe inside the workflow sandbox.
 */
function errorDetail(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error && current.message && current.message !== 'Activity task failed') {
      return current.message;
    }
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function runTenantCreationOrchestration(
  input: TenantCreationInput,
  config: TenantCreationOrchestrationConfig
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

  let customerClientId: string | undefined;
  let customerContactId: string | undefined;
  let customerTagId: string | undefined;
  let portalUserId: string | undefined;
  let portalUserCreated = false;

  setHandler(cancelWorkflowSignal, (signal: TenantCreationCancelSignal) => {
    log.info('Received cancel signal', { reason: signal.reason, cancelledBy: signal.cancelledBy });
    cancelled = true;
    cancelReason = signal.reason;
    workflowState.step = 'failed';
    workflowState.error = `Cancelled: ${signal.reason}`;
  });

  setHandler(updateWorkflowSignal, (signal: TenantCreationUpdateSignal) => {
    log.info('Received update signal', { field: signal.field, value: signal.value });
  });

  setHandler(getWorkflowStateQuery, () => workflowState);

  try {
    log.info('Starting tenant creation workflow', { input });

    // Step 0.5: Fetch Stripe details from checkout session if provided
    let stripeDetails: {
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      stripeSubscriptionItemId?: string;
      stripePriceId?: string;
      stripeBaseItemId?: string;
      stripeBasePriceId?: string;
      licenseCount?: number;
      billingAddress?: TenantBillingAddress;
    } = {
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSubscriptionItemId: input.stripeSubscriptionItemId,
      stripePriceId: input.stripePriceId,
      stripeBaseItemId: input.stripeBaseItemId,
      stripeBasePriceId: input.stripeBasePriceId,
      licenseCount: input.licenseCount,
      billingAddress: input.billingAddress,
    };

    if (input.checkoutSessionId && !input.stripeCustomerId) {
      workflowState.step = 'fetching_stripe_details';
      workflowState.progress = 5;

      log.info('Fetching Stripe details from checkout session', {
        checkoutSessionId: input.checkoutSessionId,
      });

      try {
        const fetchedStripeDetails = await activities.fetchStripeDetailsFromCheckout({
          checkoutSessionId: input.checkoutSessionId,
        });

        stripeDetails = {
          ...stripeDetails,
          ...fetchedStripeDetails,
          billingAddress: fetchedStripeDetails.billingAddress ?? stripeDetails.billingAddress,
        };

        log.info('Stripe details fetched successfully', {
          hasCustomer: !!fetchedStripeDetails.stripeCustomerId,
          hasSubscription: !!fetchedStripeDetails.stripeSubscriptionId,
          licenseCount: fetchedStripeDetails.licenseCount,
        });
      } catch (error) {
        log.warn('Failed to fetch Stripe details from checkout session', {
          error: error instanceof Error ? error.message : 'Unknown error',
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

    log.info('Creating tenant', {
      tenantName: input.tenantName,
      licenseCount: stripeDetails.licenseCount,
      hasStripeDetails: !!stripeDetails.stripeCustomerId,
    });
    const tenantCompanyName = input.companyName ?? input.tenantName;
    const tenantDefaultClientName = input.clientName ?? tenantCompanyName;

    const tenantResult = await activities.createTenant({
      tenantName: input.tenantName,
      email: input.adminUser.email,
      tenantId: input.tenantId,
      companyName: tenantCompanyName,
      clientName: tenantDefaultClientName,
      licenseCount: stripeDetails.licenseCount,
      billingSource: input.billingSource,
      plan: input.plan,
      productCode: input.productCode,
      appleIap: input.appleIap,
      stripeCustomerId: stripeDetails.stripeCustomerId,
      stripeSubscriptionId: stripeDetails.stripeSubscriptionId,
      stripeSubscriptionItemId: stripeDetails.stripeSubscriptionItemId,
      stripePriceId: stripeDetails.stripePriceId,
      billingAddress: stripeDetails.billingAddress,
      stripeBaseItemId: stripeDetails.stripeBaseItemId,
      stripeBasePriceId: stripeDetails.stripeBasePriceId,
      addons: input.addons,
    });

    tenantCreated = true;
    workflowState.tenantId = tenantResult.tenantId;
    workflowState.clientId = tenantResult.clientId;
    workflowState.progress = 40;

    log.info('Tenant created successfully', {
      tenantId: tenantResult.tenantId,
      clientId: tenantResult.clientId,
    });

    // Step 2: Run onboarding seeds (roles, permissions, etc.)
    workflowState.step = 'running_onboarding_seeds';
    workflowState.progress = 40;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    log.info('Running onboarding seeds for tenant');
    const seedsResult = await activities.run_onboarding_seeds({
      tenantId: tenantResult.tenantId,
      productCode: input.productCode,
    });

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
      clientId: tenantResult.clientId,
      password: input.adminUser.password,
    });

    userCreated = true;
    workflowState.adminUserId = userResult.userId;
    temporaryPassword = userResult.temporaryPassword;
    workflowState.progress = 70;

    log.info('Admin user created successfully', {
      userId: userResult.userId,
      roleId: userResult.roleId,
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
      clientId: tenantResult.clientId,
      contractLine: input.contractLine,
      emailProvider: input.emailProvider,
    });

    workflowState.progress = 90;

    log.info('Tenant data setup completed', { setupSteps: setupResult.setupSteps });

    // Step 5: Create customer tracking records (optional, non-blocking).
    // Skipped on appliance installs: there is no nineminds management tenant
    // to track the customer in.
    //
    // Each stage is isolated so one failure no longer starves the rest: a
    // reused client/contact is success, a portal failure is recorded (not
    // swallowed), and only an unresolvable client skips the downstream chain.
    workflowState.customerTracking = { portalStatus: 'skipped' };

    if (input.skipCustomerTracking) {
      log.info('Skipping customer tracking records (skipCustomerTracking=true)');
    } else {
      workflowState.step = 'creating_customer_tracking';
      workflowState.progress = 85;

      if (cancelled) {
        throw new Error(`Workflow cancelled: ${cancelReason}`);
      }

      log.info('Creating customer tracking records in nineminds tenant');

      // 5a. Resolve the management-tenant client.
      try {
        const customerClientResult = await activities.createCustomerClientActivity({
          tenantName: input.tenantName,
          adminUserEmail: input.adminUser.email,
        });
        customerClientId = customerClientResult.customerId;
        workflowState.customerTracking.clientId = customerClientId;
        workflowState.customerTracking.clientReused = customerClientResult.reused;

        log.info('Customer client resolved', {
          customerId: customerClientId,
          reused: customerClientResult.reused,
        });
      } catch (customerClientError) {
        const message = errorDetail(customerClientError);
        workflowState.customerTracking.clientError = message;

        log.error('Failed to resolve customer client (skipping downstream customer tracking)', {
          error: message,
          tenantName: input.tenantName,
        });

        customerClientId = undefined;
      }

      // 5b. Resolve the contact for the client.
      if (customerClientId) {
        try {
          const customerContactResult = await activities.createCustomerContactActivity({
            clientId: customerClientId,
            firstName: input.adminUser.firstName,
            lastName: input.adminUser.lastName,
            email: input.adminUser.email,
          });
          customerContactId = customerContactResult.contactId;
          workflowState.customerTracking.contactId = customerContactId;
          workflowState.customerTracking.contactReused = customerContactResult.reused;

          log.info('Customer contact resolved', {
            contactId: customerContactId,
            reused: customerContactResult.reused,
          });
        } catch (customerContactError) {
          const message = errorDetail(customerContactError);
          workflowState.customerTracking.contactError = message;

          log.error('Failed to resolve customer contact (non-fatal)', {
            error: message,
            email: input.adminUser.email,
          });

          customerContactId = undefined;
        }
      }

      // 5c. Tag the client. Tagging failures never block portal provisioning.
      if (customerClientId) {
        try {
          const tagResult = await activities.tagCustomerClientActivity({
            clientId: customerClientId,
            tagText: config.customerTag,
          });
          customerTagId = tagResult.tagId;

          log.info('Customer client tagged', { tagId: customerTagId });
        } catch (customerTagError) {
          log.error('Failed to tag customer client (non-fatal)', {
            error: customerTagError instanceof Error ? customerTagError.message : 'Unknown error',
            clientId: customerClientId,
          });
        }
      }

      // 5d. Provision the Nine Minds Support Portal user for the contact. A
      // failure here never fails tenant creation, but it is captured in state
      // and drives the welcome-email copy so we never promise access that does
      // not exist.
      if (customerContactId && customerClientId) {
        try {
          log.info('Resolving portal user in Nine Minds tenant for customer');

          const { tenantId: ninemindsTenantId } = await activities.getManagementTenantId();

          const portalUserResult = await activities.createPortalUser({
            tenantId: ninemindsTenantId,
            email: input.adminUser.email,
            password: temporaryPassword,
            contactId: customerContactId,
            clientId: customerClientId,
            firstName: input.adminUser.firstName,
            lastName: input.adminUser.lastName,
            isClientAdmin: true,
          });

          portalUserId = portalUserResult.userId;
          portalUserCreated = portalUserResult.status === 'created';
          workflowState.customerTracking.portalStatus = portalUserResult.status;

          log.info('Portal user resolved in Nine Minds tenant', {
            portalUserId,
            portalStatus: portalUserResult.status,
            roleId: portalUserResult.roleId,
            tenantId: ninemindsTenantId,
          });
        } catch (portalUserError) {
          const message = errorDetail(portalUserError);
          workflowState.customerTracking.portalStatus = 'failed';
          workflowState.customerTracking.portalError = message;

          log.error('Failed to create portal user in Nine Minds tenant (non-fatal)', {
            error: message,
            email: input.adminUser.email,
          });
        }
      }

      workflowState.progress = 90;
    }

    // Step 6: Send welcome email. Skipped on appliance installs: the operator
    // set their own password during setup, so there is no credential to send.
    workflowState.step = 'sending_welcome_email';
    workflowState.progress = 95;

    if (cancelled) {
      throw new Error(`Workflow cancelled: ${cancelReason}`);
    }

    if (input.skipWelcomeEmail) {
      log.info('Skipping welcome email (skipWelcomeEmail=true)');
    } else {
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
        clientName: tenantDefaultClientName,
        companyName: tenantCompanyName,
        productCode: input.productCode,
        portalStatus: workflowState.customerTracking?.portalStatus,
      });

      emailSent = emailResult.emailSent;
    }
    workflowState.emailSent = emailSent;

    // Step 7: Schedule the trial payment reminder for hosted Stripe signups.
    // Runs as an abandoned child so its ~13-day timer outlives this workflow's
    // run timeout; failures here must never fail tenant creation.
    const isHostedStripeSignup =
      !!stripeDetails.stripeSubscriptionId &&
      (input.billingSource === undefined || input.billingSource === 'stripe') &&
      // AlgaDesk is sold without a trial, so there is no first payment to warn about.
      input.productCode !== 'algadesk' &&
      !input.skipWelcomeEmail &&
      !input.skipCustomerTracking;

    if (isHostedStripeSignup) {
      try {
        await startChild(trialPaymentReminderWorkflow, {
          workflowId: `trial-payment-reminder-${tenantResult.tenantId}`,
          args: [{
            tenantId: tenantResult.tenantId,
            stripeSubscriptionId: stripeDetails.stripeSubscriptionId!,
            tenantName: input.tenantName,
            companyName: tenantCompanyName,
          }],
          parentClosePolicy: ParentClosePolicy.ABANDON,
          workflowExecutionTimeout: '60 days',
        });

        workflowState.trialReminderScheduled = true;
        log.info('Trial payment reminder scheduled', {
          tenantId: tenantResult.tenantId,
          stripeSubscriptionId: stripeDetails.stripeSubscriptionId,
        });
      } catch (reminderError) {
        workflowState.trialReminderScheduled = false;
        log.warn('Failed to schedule trial payment reminder (non-fatal)', {
          tenantId: tenantResult.tenantId,
          error: reminderError instanceof Error ? reminderError.message : 'Unknown error',
        });
      }
    }

    workflowState.progress = 100;
    workflowState.step = 'completed';

    log.info('Tenant creation completed successfully', {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      setupSteps: ['skipped_for_e2e_compatibility'],
      emailSent,
    });

    return {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      clientId: tenantResult.clientId,
      temporaryPassword,
      emailSent,
      success: true,
      createdAt: new Date().toISOString(),
      customerClientId,
      customerContactId,
    };
  } catch (error) {
    workflowState.step = 'failed';
    workflowState.error = error instanceof Error ? error.message : 'Unknown error';

    // Policy: once the customer tenant row has been created, do NOT auto-rollback.
    //
    // Auto-rollback on a downstream failure was deleting paying customers'
    // tenants + Stripe records on recoverable infra blips (e.g. a stale Citus
    // loopback connection landing in a read-only session). A partial tenant
    // is recoverable manually — backfilling missing rows is cheap; restoring
    // a deleted tenant is not. Activities self-heal via
    // withAdminTransactionRetryReadOnly; anything that gets past that needs
    // a human to look at it, not a destructive cleanup.
    //
    // The rollback activities are still exposed and can be invoked manually
    // from the Temporal UI if an operator decides cleanup is the right call.
    if (tenantCreated) {
      log.error(
        'Tenant creation workflow failed AFTER tenant row was created — skipping auto-rollback, leaving state intact for manual recovery',
        {
          error: workflowState.error,
          tenantId: workflowState.tenantId,
          userCreated,
          adminUserId: workflowState.adminUserId,
          customerClientId,
          customerContactId,
          portalUserCreated,
          portalUserId,
        }
      );
      throw error;
    }

    // Pre-tenant failure: nothing was created in the customer tenant, and
    // customer-tracking / portal-user steps run only after the tenant exists,
    // so there is nothing to clean up. Surface the error.
    log.error('Tenant creation workflow failed before tenant was created — nothing to roll back', {
      error: workflowState.error,
    });

    throw error;
  }
}
