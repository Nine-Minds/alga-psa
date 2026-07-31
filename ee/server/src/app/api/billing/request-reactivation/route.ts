import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import {
  getActivePendingDeletion,
  resolveReactivationContactEmail,
  resolveTenantAndAdminEmailByEmail,
} from '@enterprise/lib/billing/tenantReactivationDetection';
import {
  createTenantReactivationToken,
  isValidReactivationLicenseCount,
} from '@enterprise/lib/billing/tenantReactivationTokens';
import {
  buildReactivationCheckoutUrl,
  sendReactivationInviteEmail,
} from '@enterprise/lib/billing/reactivationInviteEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyWebhookSignature(
  signature: string | null,
  email: string,
  licenseCount: number,
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

  const payload = `${email}:${licenseCount}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const licenseCount = body?.licenseCount;

    if (!email || !isValidReactivationLicenseCount(licenseCount)) {
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

    const knex = await getAdminConnection();
    const tenant = await resolveTenantAndAdminEmailByEmail(email, knex);

    if (!tenant) {
      return NextResponse.json({ success: true });
    }

    const pendingDeletion = await getActivePendingDeletion(tenant.tenantId, knex);
    if (!pendingDeletion?.reactivatable) {
      return NextResponse.json({ success: true });
    }

    const billingAdmin = await resolveReactivationContactEmail(tenant.tenantId, knex);
    if (!billingAdmin?.email) {
      console.warn('[request-reactivation] No reactivation contact email resolved', {
        tenantId: tenant.tenantId,
      });
      return NextResponse.json({ success: true });
    }

    const reactivationToken = await createTenantReactivationToken({
      tenantId: tenant.tenantId,
      deletionId: pendingDeletion.deletionId,
      licenseCount,
      knex,
    });

    try {
      await sendReactivationInviteEmail({
        to: billingAdmin.email,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        effectiveDeletionDate: pendingDeletion.effectiveDeletionDate,
        reactivationUrl: buildReactivationCheckoutUrl(reactivationToken.token),
      });
    } catch (emailError) {
      console.error('[request-reactivation] Failed to send invite email', {
        tenantId: tenant.tenantId,
        error: emailError,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[request-reactivation] Error requesting reactivation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
