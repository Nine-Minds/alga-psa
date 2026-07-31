import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyWebhookSignature(
  signature: string | null,
  email: string,
  licenseCount: number,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;

  const secret = process.env.ALGA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('ALGA_WEBHOOK_SECRET not configured');
    return false;
  }

  const payload = `${email}:${licenseCount}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const licenseCount = body?.licenseCount;
  const validLicenseCount = typeof licenseCount === 'number'
    && Number.isInteger(licenseCount)
    && licenseCount >= 1
    && licenseCount <= 1000;

  if (!email || !validLicenseCount) {
    return NextResponse.json(
      { error: 'Email and a valid license count are required' },
      { status: 400 },
    );
  }

  const signature = req.headers.get('x-webhook-signature');
  const timestamp = req.headers.get('x-timestamp');

  if (!verifyWebhookSignature(signature, email, licenseCount, timestamp)) {
    console.error('[request-reactivation] Invalid webhook signature');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  return NextResponse.json({ success: true });
}
