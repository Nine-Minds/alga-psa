import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import {
  getActivePendingDeletion,
  resolveTenantStripeCustomerForReactivation,
} from '@enterprise/lib/billing/tenantReactivationDetection';
import { reserveTenantReactivationToken } from '@enterprise/lib/billing/tenantReactivationTokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyWebhookSignature(
  signature: string | null,
  token: string,
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
    .update(`${token}:${timestamp}`)
    .digest('hex');

  return signature === expectedSignature;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  if (!verifyWebhookSignature(
    req.headers.get('x-webhook-signature'),
    token,
    req.headers.get('x-timestamp'),
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const knex = await getAdminConnection();
  const reservation = await reserveTenantReactivationToken(token, knex);
  if (!reservation) {
    return NextResponse.json({ error: 'Invalid or already used token' }, { status: 409 });
  }

  const pendingDeletion = await getActivePendingDeletion(reservation.tenantId, knex);
  if (!pendingDeletion || pendingDeletion.deletionId !== reservation.deletionId) {
    return NextResponse.json({ error: 'Tenant is not reactivatable' }, { status: 409 });
  }

  const stripeCustomer = await resolveTenantStripeCustomerForReactivation(
    reservation.tenantId,
    pendingDeletion,
    knex,
  );

  return NextResponse.json({
    valid: true,
    tenantId: reservation.tenantId,
    deletionId: reservation.deletionId,
    deletionWorkflowId: pendingDeletion.workflowId,
    stripeCustomerId: stripeCustomer.stripeCustomerId,
    stripeCustomerSource: stripeCustomer.source,
    priorSubscriptionExternalId: pendingDeletion.subscriptionExternalId,
    planCode: 'algapsa',
    billingInterval: 'month',
    licenseCount: reservation.licenseCount,
  });
}
