import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from '../activities/resend-welcome-email-activities';

const {
  getTenant,
  getUser,
  findAdminUser,
  generateTemporaryPassword,
  updateUserPassword,
  sendWelcomeEmail,
  logAuditEvent
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
  },
});

export interface ResendWelcomeEmailInput {
  tenantId: string;
  userId?: string;  // Optional - if not provided, finds first admin user
  triggeredBy: string;  // User ID who triggered this
  triggeredByEmail: string;
}

export interface ResendWelcomeEmailResult {
  success: boolean;
  email?: string;
  tenantName?: string;
  error?: string;
}

export async function resendWelcomeEmailWorkflow(
  input: ResendWelcomeEmailInput
): Promise<ResendWelcomeEmailResult> {
  const { tenantId, userId, triggeredBy, triggeredByEmail } = input;

  log.info('Starting resend welcome email workflow', { tenantId, userId, triggeredBy });

  try {
    // Step 1: Get tenant info
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    log.info('Found tenant', { tenantId, tenantName: tenant.client_name });

    // Step 2: Get user (specific user or first admin)
    const user = userId
      ? await getUser(userId, tenantId)
      : await findAdminUser(tenantId);

    if (!user) {
      throw new Error(`Admin user not found for tenant: ${tenantId}`);
    }

    log.info('Found user', { userId: user.user_id, email: user.email });

    // Step 3: Generate new temporary password
    const temporaryPassword = await generateTemporaryPassword();

    // Step 4: Update user password
    await updateUserPassword(user.user_id, tenantId, temporaryPassword);

    log.info('Password updated for user', { userId: user.user_id });

    // Step 5: Send welcome email
    const emailResult = await sendWelcomeEmail({
      tenantId,
      tenantName: tenant.client_name,
      adminUser: {
        userId: user.user_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      temporaryPassword,
    });

    if (!emailResult.emailSent) {
      throw new Error(`Failed to send welcome email: ${emailResult.error}`);
    }

    log.info('Welcome email sent successfully', { email: user.email });

    // Step 6: Log audit event
    await logAuditEvent({
      tenantId,
      action: 'WELCOME_EMAIL_RESENT',
      resourceType: 'user',
      resourceId: user.user_id,
      triggeredBy,
      triggeredByEmail,
      details: {
        recipientEmail: user.email,
        tenantName: tenant.client_name,
      },
    });

    return {
      success: true,
      email: user.email,
      tenantName: tenant.client_name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Resend welcome email workflow failed', { error: errorMessage });

    // Log failure audit event
    await logAuditEvent({
      tenantId,
      action: 'WELCOME_EMAIL_RESEND_FAILED',
      resourceType: 'user',
      resourceId: userId || 'unknown',
      triggeredBy,
      triggeredByEmail,
      details: { error: errorMessage },
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
