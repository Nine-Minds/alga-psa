import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminConnection } from '@alga-psa/db/admin';
import {
  getPendingDeletionSummary,
  resolveTenantAndAdminEmailByEmail,
} from '@enterprise/lib/billing/tenantReactivationDetection';

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

  const payload = `${email}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email query parameter is required' },
        { status: 400 },
      );
    }

    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-timestamp');

    if (!verifyWebhookSignature(signature, email, timestamp)) {
      console.error('[check-tenant] Invalid webhook signature');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const knex = await getAdminConnection();
    const tenant = await resolveTenantAndAdminEmailByEmail(email, knex);

    if (!tenant) {
      return NextResponse.json(
        {
          exists: false,
          pendingDeletion: false,
          reactivatable: false,
        },
        { status: 404 },
      );
    }

    const pendingDeletion = await getPendingDeletionSummary(tenant.tenantId, knex);

    return NextResponse.json({
      exists: true,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      pendingDeletion: !!pendingDeletion,
      reactivatable: pendingDeletion?.reactivatable ?? false,
      deletionStatus: pendingDeletion?.status,
      effectiveDeletionDate: pendingDeletion?.effectiveDeletionDate,
    });
  } catch (error) {
    console.error('[check-tenant] Error checking tenant:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
