/**
 * Trial payment reminder activities.
 *
 * Read the trial end from Stripe (never a hardcoded trial length), re-verify at
 * send time that the tenant is still billable, and send the reminder email.
 */

import { Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import Stripe from 'stripe';
import { emailService, type EmailParams } from '../services/email-service.js';
import { findAdminUser, getTenant } from './resend-welcome-email-activities.js';
import { createTrialPaymentReminderEmailContent } from './trial-payment-reminder-email.js';
import type {
  ResolveTrialEndActivityInput,
  ResolveTrialEndActivityResult,
  SendTrialPaymentReminderActivityInput,
  SendTrialPaymentReminderActivityResult,
  VerifyTrialReminderActivityInput,
  VerifyTrialReminderActivityResult,
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

export interface TrialReminderLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

// Statuses that still lead to a first payment. Anything else (canceled,
// incomplete_expired, unpaid, paused) means there is nothing to remind about.
const BILLABLE_STATUSES = new Set<Stripe.Subscription.Status>(['trialing', 'active']);

export interface TrialReminderStripeClient {
  subscriptions: {
    retrieve(subscriptionId: string): Promise<Stripe.Subscription>;
  };
}

export interface TrialReminderTenantRow {
  tenant?: string;
  client_name?: string;
  product_code?: 'psa' | 'algadesk';
  suspended_at?: Date | string | null;
}

export interface TrialReminderSubscriptionRow {
  status: string | null;
  canceled_at: Date | string | null;
}

export interface TrialReminderStripeDependencies {
  stripe?: TrialReminderStripeClient;
  env?: NodeJS.ProcessEnv;
  log?: TrialReminderLog;
}

export interface VerifyTrialReminderDependencies extends TrialReminderStripeDependencies {
  loadTenantRow?: (tenantId: string) => Promise<TrialReminderTenantRow | null>;
  loadSubscriptionRow?: (
    tenantId: string,
    stripeSubscriptionId: string,
  ) => Promise<TrialReminderSubscriptionRow | null>;
}

export interface SendTrialPaymentReminderDependencies {
  log?: TrialReminderLog;
  loadTenantRow?: (tenantId: string) => Promise<TrialReminderTenantRow | null>;
  loadAdminUser?: (tenantId: string) => Promise<
    { user_id: string; email: string; first_name: string; last_name: string } | undefined
  >;
  sendEmail?: (params: EmailParams) => Promise<{ messageId?: string }>;
  validateEmail?: (email: string) => boolean;
}

let stripeClient: Stripe | null = null;

function defaultStripeClient(env: NodeJS.ProcessEnv): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not configured in the temporal worker. ' +
      'Please add it to the worker deployment configuration.'
    );
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2024-12-18.acacia' as any,
    typescript: true,
  });
  return stripeClient;
}

function resolveStripe(dependencies: TrialReminderStripeDependencies): TrialReminderStripeClient {
  return dependencies.stripe ?? defaultStripeClient(dependencies.env ?? process.env);
}

function toIso(epochSeconds: number | null | undefined): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

async function loadTenantRowFromDb(tenantId: string): Promise<TrialReminderTenantRow | null> {
  const tenant = await getTenant(tenantId);
  return (tenant as TrialReminderTenantRow | undefined) ?? null;
}

async function loadSubscriptionRowFromDb(
  tenantId: string,
  stripeSubscriptionId: string,
): Promise<TrialReminderSubscriptionRow | null> {
  const knex = await getAdminConnection();
  const row = await tenantDb(knex, tenantId)
    .table<TrialReminderSubscriptionRow>('stripe_subscriptions')
    .where('stripe_subscription_external_id', stripeSubscriptionId)
    .select('status', 'canceled_at')
    .first();
  return row ?? null;
}

/**
 * Read the subscription's trial end from Stripe. Returns null when the
 * subscription never had a trial — trial length lives in Stripe, not here.
 */
export async function resolveTrialEndFromStripe(
  input: ResolveTrialEndActivityInput,
  dependencies: TrialReminderStripeDependencies = {},
): Promise<ResolveTrialEndActivityResult> {
  const log = dependencies.log ?? logger();
  const stripe = resolveStripe(dependencies);

  const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
  const trialEndIso = toIso(subscription.trial_end);

  log.info('Resolved trial end from Stripe', {
    stripeSubscriptionId: input.stripeSubscriptionId,
    status: subscription.status,
    trialEndIso,
  });

  return { trialEndIso };
}

/**
 * Re-check, at send time, that the tenant is still on the hook for a payment.
 * Any Stripe/DB failure throws so Temporal retries; the workflow treats a
 * definitively failed verification as "do not send".
 */
export async function verifyTenantBillableForTrialReminder(
  input: VerifyTrialReminderActivityInput,
  dependencies: VerifyTrialReminderDependencies = {},
): Promise<VerifyTrialReminderActivityResult> {
  const log = dependencies.log ?? logger();
  const loadTenantRow = dependencies.loadTenantRow ?? loadTenantRowFromDb;
  const loadSubscriptionRow = dependencies.loadSubscriptionRow ?? loadSubscriptionRowFromDb;

  const tenant = await loadTenantRow(input.tenantId);
  if (!tenant) {
    log.warn('Trial reminder skipped: tenant no longer exists', { tenantId: input.tenantId });
    return { sendable: false, reason: 'tenant_missing' };
  }
  if (tenant.suspended_at) {
    log.info('Trial reminder skipped: tenant is suspended', { tenantId: input.tenantId });
    return { sendable: false, reason: 'tenant_suspended' };
  }

  const subscriptionRow = await loadSubscriptionRow(input.tenantId, input.stripeSubscriptionId);
  if (subscriptionRow && (subscriptionRow.status === 'canceled' || subscriptionRow.canceled_at)) {
    log.info('Trial reminder skipped: local subscription record is cancelled', {
      tenantId: input.tenantId,
      status: subscriptionRow.status,
    });
    return { sendable: false, reason: 'subscription_cancelled' };
  }

  const stripe = resolveStripe(dependencies);
  const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);

  if (!BILLABLE_STATUSES.has(subscription.status)) {
    log.info('Trial reminder skipped: Stripe subscription is not billable', {
      tenantId: input.tenantId,
      status: subscription.status,
    });
    return { sendable: false, reason: 'subscription_cancelled' };
  }

  if (subscription.cancel_at_period_end || subscription.cancel_at || subscription.canceled_at) {
    log.info('Trial reminder skipped: cancellation already scheduled', {
      tenantId: input.tenantId,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: subscription.cancel_at,
      canceledAt: subscription.canceled_at,
    });
    return { sendable: false, reason: 'cancellation_scheduled' };
  }

  return { sendable: true, currentTrialEndIso: toIso(subscription.trial_end) };
}

/**
 * Send the reminder. The recipient is resolved here (not when the reminder was
 * scheduled ~13 days earlier) so admin changes in the meantime are honoured.
 */
export async function sendTrialPaymentReminderEmail(
  input: SendTrialPaymentReminderActivityInput,
  dependencies: SendTrialPaymentReminderDependencies = {},
): Promise<SendTrialPaymentReminderActivityResult> {
  const log = dependencies.log ?? logger();
  const loadTenantRow = dependencies.loadTenantRow ?? loadTenantRowFromDb;
  const loadAdminUser = dependencies.loadAdminUser ?? findAdminUser;

  const tenant = await loadTenantRow(input.tenantId);
  const adminUser = await loadAdminUser(input.tenantId);
  if (!adminUser) {
    log.warn('Trial reminder not sent: no active admin user for tenant', {
      tenantId: input.tenantId,
    });
    return { emailSent: false, error: 'No active admin user found for tenant' };
  }

  const { subject, htmlBody, textBody } = createTrialPaymentReminderEmailContent({
    tenantName: input.tenantName || tenant?.client_name || '',
    trialEndIso: input.trialEndIso,
    recipientFirstName: adminUser.first_name,
    recipientLastName: adminUser.last_name,
    productCode: input.productCode ?? tenant?.product_code,
  });

  const needsEmailService = !dependencies.validateEmail || !dependencies.sendEmail;
  const emailServiceInstance = needsEmailService ? await emailService : null;
  const validateEmail = dependencies.validateEmail
    ?? ((email: string) => emailServiceInstance!.validateEmail(email));
  const sendEmail = dependencies.sendEmail
    ?? ((params: EmailParams) => emailServiceInstance!.sendEmail(params));

  if (!validateEmail(adminUser.email)) {
    log.warn('Trial reminder not sent: invalid recipient address', { tenantId: input.tenantId });
    return { emailSent: false, error: `Invalid email address: ${adminUser.email}` };
  }

  const emailParams: EmailParams = {
    to: adminUser.email,
    subject,
    html: htmlBody,
    text: textBody,
    metadata: {
      tenantId: input.tenantId,
      userId: adminUser.user_id,
      emailType: 'trial_payment_reminder',
      trialEnd: input.trialEndIso,
      workflowType: 'trial_payment_reminder',
    },
  };

  // Send failures throw so Temporal retries the activity.
  const emailResult = await sendEmail(emailParams);

  log.info('Trial payment reminder sent', {
    tenantId: input.tenantId,
    email: adminUser.email,
    messageId: emailResult?.messageId,
  });

  return { emailSent: true, messageId: emailResult?.messageId };
}
