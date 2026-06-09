import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import { getSystemEmailService } from '@alga-psa/email';
import { getPendingDeletionSummary } from '@enterprise/lib/billing/tenantReactivationDetection';
import { rollbackTenantDeletion } from '@ee/lib/tenant-management/workflowClient';
import { getStripeService } from '@ee/lib/stripe/StripeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RefusalReason = 'past_window' | 'duplicate_payment';

// pending_tenant_deletions.rolled_back_by is a uuid column (the admin path passes
// a user id). Reactivation is system-triggered with no user, so use the nil-uuid
// sentinel; the rollback reason carries the human-readable context.
const REACTIVATION_SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

/**
 * Authoritative, server-side confirmation that Stripe actually captured the
 * payment for this checkout session — independent of nm-store's pre-call gate
 * and of the (HMAC-signed) caller. Reactivation re-bills the customer and
 * resurrects their tenant + data, so we never signal the rollback on an
 * unpaid/incomplete session.
 */
async function isCheckoutSessionPaid(checkoutSessionId: string): Promise<boolean> {
  const stripe = await getStripeService().getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  return session.status === 'complete' && session.payment_status === 'paid';
}

// Idempotency anchor: has THIS checkout session's subscription already been
// linked as the tenant's active subscription? If so, a re-fired completion
// (e.g. the success page being refreshed) is a harmless no-op rather than a
// duplicate payment.
async function sessionAlreadyReactivated(
  tenantId: string,
  stripeSubscriptionId: string,
): Promise<boolean> {
  const knex = await getAdminConnection();
  const row = await knex('stripe_subscriptions')
    .where({ tenant: tenantId, stripe_subscription_external_id: stripeSubscriptionId })
    .whereIn('status', ['active', 'trialing'])
    .first('stripe_subscription_id');
  return !!row;
}

function verifyWebhookSignature(
  signature: string | null,
  checkoutSessionId: string,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;

  const timestampMs = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const secret = process.env.ALGA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('ALGA_WEBHOOK_SECRET not configured');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${checkoutSessionId}:${timestamp}`)
    .digest('hex');

  return signature === expectedSignature;
}

async function alertManualRefund(input: {
  tenantId: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  subscriptionId?: string;
  reason: RefusalReason;
}) {
  const knex = await getAdminConnection();
  await knex('pending_reactivation_refunds').insert({
    tenant: input.tenantId,
    stripe_checkout_session_id: input.checkoutSessionId ?? null,
    stripe_payment_intent_id: input.paymentIntentId ?? null,
    stripe_subscription_external_id: input.subscriptionId ?? null,
    reason: input.reason,
    created_at: knex.fn.now(),
  });

  const opsEmail = process.env.REACTIVATION_REFUND_ALERT_EMAIL || process.env.BILLING_OPS_EMAIL;
  if (!opsEmail) {
    return;
  }

  const emailService = await getSystemEmailService();
  await emailService.sendEmail({
    to: opsEmail,
    from: 'info@nineminds.com',
    subject: `Manual reactivation payment review: ${input.reason}`,
    html: [
      '<h1>Manual reactivation payment review</h1>',
      `<p>Tenant: ${input.tenantId}</p>`,
      `<p>Reason: ${input.reason}</p>`,
      `<p>Checkout session: ${input.checkoutSessionId ?? 'n/a'}</p>`,
      `<p>Payment intent: ${input.paymentIntentId ?? 'n/a'}</p>`,
      `<p>Subscription: ${input.subscriptionId ?? 'n/a'}</p>`,
    ].join(''),
    text: `Manual reactivation payment review\nTenant: ${input.tenantId}\nReason: ${input.reason}\nCheckout session: ${input.checkoutSessionId ?? 'n/a'}\nPayment intent: ${input.paymentIntentId ?? 'n/a'}\nSubscription: ${input.subscriptionId ?? 'n/a'}`,
    tenantId: input.tenantId,
    entityType: 'tenant_reactivation',
    entityId: input.checkoutSessionId ?? input.tenantId,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const checkoutSessionId = typeof body?.checkoutSessionId === 'string'
    ? body.checkoutSessionId.trim()
    : '';

  if (!checkoutSessionId) {
    return NextResponse.json({ error: 'checkoutSessionId is required' }, { status: 400 });
  }

  if (!verifyWebhookSignature(
    req.headers.get('x-webhook-signature'),
    checkoutSessionId,
    req.headers.get('x-timestamp'),
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = String(body?.tenantId || '');
  const deletionWorkflowId = String(body?.deletionWorkflowId || '');
  const stripeCustomerId = String(body?.stripeCustomerId || '');
  const stripeSubscriptionId = String(body?.stripeSubscriptionId || '');
  const stripePriceId = String(body?.stripePriceId || '');

  if (!tenantId || !deletionWorkflowId || !stripeCustomerId || !stripeSubscriptionId || !stripePriceId) {
    return NextResponse.json({ error: 'Missing required reactivation fields' }, { status: 400 });
  }

  // Confirm the payment was actually captured before doing anything else. This
  // runs BEFORE the reactivatable check on purpose: the refusal paths below
  // write a refund row (they assume money was taken), so an unpaid session must
  // bail here — with no refund row, because nothing was charged.
  let paymentCaptured: boolean;
  try {
    paymentCaptured = await isCheckoutSessionPaid(checkoutSessionId);
  } catch (error) {
    console.error('[complete-reactivation] Failed to verify checkout payment status', {
      checkoutSessionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Fail closed: never reactivate without a confirmed payment. 502 lets the
    // caller retry a transient Stripe error.
    return NextResponse.json({ success: false, state: 'payment_unverified' }, { status: 502 });
  }

  if (!paymentCaptured) {
    return NextResponse.json({ success: false, state: 'payment_not_captured' }, { status: 402 });
  }

  const pendingDeletion = await getPendingDeletionSummary(tenantId);
  if (!pendingDeletion?.reactivatable) {
    // Re-fired completion for the same session (e.g. success-page refresh): if
    // this session's subscription is already the tenant's active link, no-op.
    if (await sessionAlreadyReactivated(tenantId, stripeSubscriptionId)) {
      return NextResponse.json({ success: true, state: 'already_reactivated' });
    }
    const reason: RefusalReason = pendingDeletion?.status === 'rolled_back'
      ? 'duplicate_payment'
      : 'past_window';
    await alertManualRefund({
      tenantId,
      checkoutSessionId,
      paymentIntentId: typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : undefined,
      subscriptionId: stripeSubscriptionId,
      reason,
    });
    return NextResponse.json({ success: false, state: reason }, { status: 409 });
  }

  const result = await rollbackTenantDeletion(
    deletionWorkflowId,
    'Paid tenant reactivation',
    REACTIVATION_SYSTEM_ACTOR,
    {
      stripeCustomerId,
      stripeSubscriptionId,
      stripeSubscriptionItemId: typeof body?.stripeSubscriptionItemId === 'string'
        ? body.stripeSubscriptionItemId
        : undefined,
      stripePriceId,
      checkoutSessionId,
      sendPasswordReset: true,
    },
  );

  if (!result.success) {
    // The workflow may have already closed from a prior completion of THIS same
    // session (e.g. a near-simultaneous refresh). If this session's sub is
    // already linked, treat as a no-op rather than a duplicate payment.
    if (await sessionAlreadyReactivated(tenantId, stripeSubscriptionId)) {
      return NextResponse.json({ success: true, state: 'already_reactivated' });
    }
    await alertManualRefund({
      tenantId,
      checkoutSessionId,
      paymentIntentId: typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : undefined,
      subscriptionId: stripeSubscriptionId,
      reason: 'duplicate_payment',
    });
    return NextResponse.json({ success: false, state: 'duplicate_payment' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
