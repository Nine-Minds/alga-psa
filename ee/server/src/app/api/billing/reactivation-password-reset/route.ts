import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requestPasswordReset } from '@alga-psa/auth/actions/auth-actions/passwordResetActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyWebhookSignature(
  signature: string | null,
  email: string,
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
    .update(`${email}:${timestamp}`)
    .digest('hex');

  return signature === expectedSignature;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  if (!verifyWebhookSignature(
    req.headers.get('x-webhook-signature'),
    email,
    req.headers.get('x-timestamp'),
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await requestPasswordReset(email, 'internal');
  return NextResponse.json({ success: true });
}
