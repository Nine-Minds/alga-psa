import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, UnauthorizedError } from '@/lib/api/middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getConnection } from '@/lib/db/db';
import { startTenantDeletionWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { decryptAppleRefreshToken, revokeAppleRefreshToken } from '@/lib/mobileAuth/appleSignIn';

/**
 * POST /api/v1/mobile/account/delete
 *
 * Required by App Store guideline 5.1.1(v): any app that supports account
 * creation must offer in-app account deletion.
 *
 * Semantics:
 *  - Always soft-delete the calling user.
 *  - If the user is the sole internal user of an Apple-IAP Solo tenant,
 *    also trigger tenant deletion via the existing Temporal workflow.
 *  - Apple subscription cancellation is user-driven (iOS Settings > Apple ID >
 *    Subscriptions). We surface instructions in the response so the mobile
 *    client can show them.
 */

async function authenticate(req: NextRequest): Promise<{ tenant: string; userId: string }> {
  let apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    // Also accept Bearer token (mobile client sends accessToken via Authorization header)
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7);
    }
  }
  if (!apiKey) throw new UnauthorizedError('API key required');

  const tenantId = req.headers.get('x-tenant-id');
  const keyRecord = tenantId
    ? await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId)
    : await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);

  if (!keyRecord) throw new UnauthorizedError('Invalid API key');
  return { tenant: keyRecord.tenant, userId: keyRecord.user_id };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);

    const knex = await getConnection(null);

    // 1. Figure out the tenant's billing source and admin headcount.
    const tenantRow = await knex('tenants').where({ tenant }).first<{
      tenant: string;
      billing_source: string | null;
      plan: string | null;
    }>();

    if (!tenantRow) {
      return NextResponse.json({ ok: true, deleted: false, reason: 'tenant not found' });
    }

    const otherInternalUsers = await knex('users')
      .where({ tenant, user_type: 'internal', is_inactive: false })
      .whereNot({ user_id: userId })
      .count<{ count: string }[]>('user_id as count');

    const otherCount = Number(otherInternalUsers[0]?.count ?? 0);

    // 2. Soft-delete the user. Use a transaction so we can't leave a half-deleted row.
    await knex.transaction(async (trx) => {
      await trx('users')
        .where({ user_id: userId, tenant })
        .update({
          is_inactive: true,
        });

      // Best-effort: deactivate any API keys the user still has.
      await trx('api_keys').where({ user_id: userId, tenant }).update({ active: false });
    });

    // 2b. Revoke any Sign in with Apple grants for this user (guideline 5.1.1(v))
    //     and remove the identity mapping so a future SIWA attempt gets a fresh link.
    const appleIdentities = await knex('apple_user_identities')
      .where({ tenant, user_id: userId })
      .select<{ apple_user_id: string; apple_refresh_token_enc: string | null }[]>([
        'apple_user_id',
        'apple_refresh_token_enc',
      ]);

    for (const identity of appleIdentities) {
      if (identity.apple_refresh_token_enc) {
        try {
          const plain = await decryptAppleRefreshToken(identity.apple_refresh_token_enc);
          if (plain) {
            await revokeAppleRefreshToken(plain);
          }
        } catch (e) {
          // Revoke is best-effort — if Apple is unreachable or the token
          // is stale we still proceed with deleting our side.
          console.warn('[mobile/account/delete] Apple refresh token revoke failed', {
            appleUserId: identity.apple_user_id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (appleIdentities.length > 0) {
      await knex('apple_user_identities').where({ tenant, user_id: userId }).del();
    }

    // 3. If this was the last internal user on an IAP tenant, nuke the tenant.
    //    For Stripe tenants we leave tenant lifecycle to the Stripe webhook path.
    let tenantDeletionWorkflowId: string | null = null;
    if (otherCount === 0 && tenantRow.billing_source === 'apple_iap') {
      const result = await startTenantDeletionWorkflow({
        tenantId: tenant,
        triggerSource: 'manual',
        triggeredBy: userId,
        reason: 'apple_iap_account_deletion',
      });
      if (result.available) {
        tenantDeletionWorkflowId = result.workflowId ?? null;
      }
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      tenantDeleted: Boolean(tenantDeletionWorkflowId),
      tenantDeletionWorkflowId,
      // Mobile client shows this message after deletion so the user knows to
      // cancel their Apple subscription themselves.
      subscriptionCancellationInstructions:
        'To stop future Apple charges, open the Settings app on your iPhone → tap your name → Subscriptions → Alga PSA → Cancel Subscription.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
