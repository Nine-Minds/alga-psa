import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { getConnection } from '@/lib/db/db';
import { issueMobileOtt } from '@/lib/mobileAuth/mobileAuthService';
import { getAppleIapConfig, getTransactionInfo } from '@/lib/iap/appStoreServer';

/**
 * POST /api/v1/mobile/iap/restore
 *
 * "Restore Purchases" flow for reinstalled devices. The client re-runs
 * StoreKit, gets an originalTransactionId, and sends it here. We look up
 * the tenant that was provisioned for that transaction and return an OTT.
 *
 * Unlike /provision, this endpoint will NOT create a new tenant. If the
 * transaction has never been provisioned, we return 404 and the client
 * should fall back to the normal /provision flow.
 */

const restoreSchema = z.object({
  originalTransactionId: z.string().min(1),
  state: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = restoreSchema.parse(body);

    const config = await getAppleIapConfig();

    // Confirm the transaction with Apple before trusting the ID the client sent.
    const tx = await getTransactionInfo(parsed.originalTransactionId, config);
    if (!tx) {
      return handleApiError(new ValidationError('Apple transaction not found'));
    }
    if (tx.bundleId !== config.bundleId) {
      return handleApiError(new ValidationError('Transaction bundleId mismatch'));
    }

    const canonicalId = tx.originalTransactionId;

    const knex = await getConnection(null);
    const sub = await knex('apple_iap_subscriptions')
      .where({ original_transaction_id: canonicalId })
      .first<{ tenant: string; status: string }>();

    if (!sub) {
      return handleApiError(
        new NotFoundError('No workspace is linked to this purchase yet'),
      );
    }

    if (sub.status === 'revoked' || sub.status === 'refunded' || sub.status === 'expired') {
      return handleApiError(
        new ValidationError(`Subscription is ${sub.status} — cannot restore access`),
      );
    }

    // Find the admin user to bind the OTT to.
    const admin = await knex('users')
      .where({ tenant: sub.tenant, user_type: 'internal' })
      .orderBy('created_at', 'asc')
      .first<{ user_id: string }>('user_id');

    if (!admin) {
      return handleApiError(
        new ValidationError('Tenant exists but has no admin user — please contact support'),
      );
    }

    const { ott, expiresAtMs } = await issueMobileOtt({
      tenantId: sub.tenant,
      userId: admin.user_id,
      state: parsed.state,
      metadata: { source: 'apple_iap_restore', originalTransactionId: canonicalId },
    });

    return NextResponse.json({
      tenantId: sub.tenant,
      ott,
      expiresInSec: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
