import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { getConnection } from '@/lib/db/db';
import { issueMobileOtt } from '@/lib/mobileAuth/mobileAuthService';
import {
  getAllSubscriptionStatuses,
  getAppleIapConfig,
  getTransactionInfo,
  verifyTransactionJws,
  type JWSTransactionDecodedPayload,
} from '@/lib/iap/appStoreServer';
import { startTenantCreationWorkflow } from '@ee/lib/tenant-management/workflowClient';

/**
 * POST /api/v1/mobile/iap/provision
 *
 * Called by the iOS app immediately after a successful StoreKit 2 purchase.
 * Validates the Apple transaction, either returns an existing tenant
 * (idempotent for re-installs / retries) or triggers tenant creation via
 * Temporal, and hands back a one-time token the client can exchange for
 * a session via the existing /api/v1/mobile/auth/exchange endpoint.
 *
 * Body:
 *   {
 *     originalTransactionId: string,
 *     appAccountToken?: string,       // UUID the client included in the purchase
 *     emailHint?: string,             // optional, for new-workspace admin email
 *     firstName?: string,
 *     lastName?: string,
 *     workspaceName?: string,
 *     state: string                    // same OTT state the client will pass to /exchange
 *   }
 *
 * Response:
 *   {
 *     tenantId: string,
 *     ott: string,
 *     expiresInSec: number,
 *     status: 'created' | 'already_provisioned'
 *   }
 */

const provisionSchema = z.object({
  originalTransactionId: z.string().min(1),
  appAccountToken: z.string().uuid().optional(),
  emailHint: z.string().email().optional(),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  workspaceName: z.string().min(1).max(120).optional(),
  state: z.string().min(1),
});

type ExistingSubscription = {
  tenant: string;
  original_transaction_id: string;
  status: string;
};

async function findExistingSubscription(
  originalTransactionId: string,
): Promise<ExistingSubscription | null> {
  const knex = await getConnection(null);
  const row = await knex('apple_iap_subscriptions')
    .where({ original_transaction_id: originalTransactionId })
    .first();
  return (row as ExistingSubscription) ?? null;
}

async function findAdminUserForTenant(tenantId: string): Promise<{ userId: string } | null> {
  const knex = await getConnection(null);
  const row = await knex('users')
    .where({ tenant: tenantId, user_type: 'internal' })
    .orderBy('created_at', 'asc')
    .first('user_id');
  if (!row) return null;
  return { userId: (row as any).user_id };
}

function deriveNameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? 'owner';
  const cleaned = local.replace(/[._+-]+/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  return {
    firstName: capitalize(parts[0] ?? 'Mobile'),
    lastName: capitalize(parts[1] ?? 'Owner'),
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = provisionSchema.parse(body);

    // 1. Resolve the transaction with Apple. This confirms the purchase is
    //    real and gives us a canonical product + expiry, not whatever the
    //    client chose to send us.
    const config = await getAppleIapConfig();
    let txPayload: JWSTransactionDecodedPayload | null;
    try {
      txPayload = await getTransactionInfo(parsed.originalTransactionId, config);
    } catch (e) {
      return handleApiError(
        new ValidationError(
          'Unable to verify Apple transaction',
          e instanceof Error ? [{ message: e.message, path: [] }] : undefined,
        ),
      );
    }

    if (!txPayload) {
      return handleApiError(new ValidationError('Apple transaction not found'));
    }

    // Defensive: make sure the transaction is actually ours.
    if (txPayload.bundleId !== config.bundleId) {
      return handleApiError(new ValidationError('Transaction bundleId mismatch'));
    }

    // Use Apple's canonical originalTransactionId, not whatever the client sent.
    const canonicalOriginalTxId = txPayload.originalTransactionId;

    // 2. Idempotency: if we already have this transaction mapped to a tenant,
    //    just mint a fresh OTT and return it. This handles reinstalls, retries,
    //    and the "Restore Purchases" path.
    const existing = await findExistingSubscription(canonicalOriginalTxId);
    if (existing) {
      const admin = await findAdminUserForTenant(existing.tenant);
      if (!admin) {
        // Tenant exists but has no admin user somehow — treat as corruption.
        return handleApiError(
          new ValidationError('Tenant exists but has no admin user — please contact support'),
        );
      }

      const { ott, expiresAtMs } = await issueMobileOtt({
        tenantId: existing.tenant,
        userId: admin.userId,
        state: parsed.state,
        metadata: { source: 'apple_iap', originalTransactionId: canonicalOriginalTxId },
      });

      return NextResponse.json({
        status: 'already_provisioned',
        tenantId: existing.tenant,
        ott,
        expiresInSec: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
      });
    }

    // 3. New transaction → start tenant creation workflow with billingSource='apple_iap'.
    //    Also confirm the subscription is actually active by checking status.
    const statuses = await getAllSubscriptionStatuses(canonicalOriginalTxId, config);
    const active = statuses.data
      .flatMap((g) => g.lastTransactions)
      .find((t) => t.originalTransactionId === canonicalOriginalTxId);

    if (!active) {
      return handleApiError(
        new ValidationError('Transaction found but subscription status is missing'),
      );
    }
    // status 1=Active, 3=InBillingRetry, 4=InGracePeriod are all usable; 2=Expired, 5=Revoked are not.
    if (![1, 3, 4].includes(active.status)) {
      return handleApiError(
        new ValidationError(`Subscription is not active (Apple status=${active.status})`),
      );
    }

    // Re-verify the transaction using the signed payload from the subscription
    // status call, since that's the most authoritative source.
    const verified = verifyTransactionJws(active.signedTransactionInfo, config);

    // Work out the admin user details. Prefer what the client sent, fall back
    // to deriving from Apple's transaction storefront (which we don't have an
    // email from, so require at least emailHint from the client).
    if (!parsed.emailHint) {
      return handleApiError(
        new ValidationError('emailHint is required when provisioning a new workspace'),
      );
    }

    const derivedName = deriveNameFromEmail(parsed.emailHint);
    const firstName = parsed.firstName ?? derivedName.firstName;
    const lastName = parsed.lastName ?? derivedName.lastName;
    const workspaceName = parsed.workspaceName ?? `${firstName}'s Workspace`;

    const workflowResult = await startTenantCreationWorkflow({
      tenantName: workspaceName,
      companyName: workspaceName,
      clientName: workspaceName,
      licenseCount: 1,
      adminUser: {
        firstName,
        lastName,
        email: parsed.emailHint,
      },
      billingSource: 'apple_iap',
      plan: 'solo',
      appleIap: {
        originalTransactionId: canonicalOriginalTxId,
        productId: verified.productId,
        bundleId: verified.bundleId,
        environment: verified.environment,
        appAccountToken: verified.appAccountToken ?? parsed.appAccountToken,
        latestTransactionId: verified.transactionId,
        expiresAt: verified.expiresDate ? new Date(verified.expiresDate).toISOString() : undefined,
        originalPurchaseAt: verified.originalPurchaseDate
          ? new Date(verified.originalPurchaseDate).toISOString()
          : undefined,
      },
    });

    if (!workflowResult.available || !workflowResult.result) {
      return handleApiError(
        new ValidationError(
          `Tenant creation unavailable: ${workflowResult.error ?? 'Temporal client not available'}`,
        ),
      );
    }

    // Wait for the workflow to finish. Tenant creation typically takes a few
    // seconds, well under our request timeout. If this becomes a problem we
    // can switch to a polling endpoint.
    const result = await workflowResult.result;
    if (!result.success || !result.tenantId || !result.adminUserId) {
      return handleApiError(
        new ValidationError(`Tenant creation failed: ${result.error ?? 'unknown error'}`),
      );
    }

    // 4. Mint an OTT for the newly-created admin so the mobile client can
    //    exchange it for a session via /api/v1/mobile/auth/exchange.
    const { ott, expiresAtMs } = await issueMobileOtt({
      tenantId: result.tenantId,
      userId: result.adminUserId,
      state: parsed.state,
      metadata: { source: 'apple_iap', originalTransactionId: canonicalOriginalTxId },
    });

    return NextResponse.json({
      status: 'created',
      tenantId: result.tenantId,
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
