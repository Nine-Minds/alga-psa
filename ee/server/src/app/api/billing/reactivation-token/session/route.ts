import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import { attachCheckoutSessionToReactivationToken } from '@enterprise/lib/billing/tenantReactivationTokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyWebhookSignature(
  signature: string | null,
  token: string,
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
    .update(`${token}:${checkoutSessionId}:${timestamp}`)
    .digest('hex');

  return signature === expectedSignature;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const checkoutSessionId = typeof body?.checkoutSessionId === 'string'
    ? body.checkoutSessionId.trim()
    : '';

  if (!token || !checkoutSessionId) {
    return NextResponse.json(
      { error: 'Token and checkoutSessionId are required' },
      { status: 400 },
    );
  }

  if (!verifyWebhookSignature(
    req.headers.get('x-webhook-signature'),
    token,
    checkoutSessionId,
    req.headers.get('x-timestamp'),
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const attached = await attachCheckoutSessionToReactivationToken(
    token,
    checkoutSessionId,
    await getAdminConnection(),
  );

  if (!attached) {
    return NextResponse.json({ error: 'Token is not reserved' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
