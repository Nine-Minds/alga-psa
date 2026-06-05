import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import { getSystemEmailService } from '@alga-psa/email';
import { getPendingDeletionSummary } from '@enterprise/lib/billing/tenantReactivationDetection';
import { rollbackTenantDeletion } from '@ee/lib/tenant-management/workflowClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RefusalReason = 'past_window' | 'duplicate_payment';

function verifyWebhookSignature(
  signature: string | null,
  checkoutSessionId: string,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;

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

  const pendingDeletion = await getPendingDeletionSummary(tenantId);
  if (!pendingDeletion?.reactivatable) {
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
    'reactivation_checkout',
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
