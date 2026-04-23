import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getConnection } from '@/lib/db/db';
import {
  decryptAppleRefreshToken,
  encryptAppleRefreshToken,
  exchangeAppleAuthorizationCode,
  getAppleSignInConfig,
  revokeAppleRefreshToken,
  verifyAppleIdentityToken,
} from '@/lib/mobileAuth/appleSignIn';

/**
 * /api/v1/mobile/auth/apple/link
 *
 * Companion to /api/v1/mobile/auth/apple. Lets a user who is already signed
 * in (via any method — Google, Microsoft, etc.) attach an Apple ID to their
 * existing Alga user so subsequent Sign in with Apple calls resolve.
 *
 * Required because the unauthenticated /auth/apple endpoint refuses to link
 * when the Apple email and Alga email differ — common in B2B deployments
 * where the Apple ID is personal and the Alga account is corporate.
 *
 * GET    — report current link status for the caller's user.
 * POST   — verify identity token, link it to the caller's user, optionally
 *          store the encrypted refresh token for later account-deletion revoke.
 * DELETE — unlink, revoking the Apple refresh token when we have it.
 */

async function authenticate(req: NextRequest): Promise<{ tenant: string; userId: string }> {
  let apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) apiKey = authHeader.slice(7);
  }
  if (!apiKey) throw new UnauthorizedError('API key required');

  const tenantId = req.headers.get('x-tenant-id');
  const keyRecord = tenantId
    ? await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId)
    : await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord) throw new UnauthorizedError('Invalid API key');
  return { tenant: keyRecord.tenant, userId: keyRecord.user_id };
}

const postSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const knex = await getConnection(null);
    const row = await knex('apple_user_identities')
      .where({ tenant, user_id: userId })
      .first<{ apple_user_id: string; email: string | null; is_private_email: boolean } | undefined>([
        'apple_user_id',
        'email',
        'is_private_email',
      ]);

    if (!row) {
      return NextResponse.json({ linked: false });
    }
    return NextResponse.json({
      linked: true,
      email: row.email,
      isPrivateEmail: row.is_private_email,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.parse(body);

    const cfg = await getAppleSignInConfig();
    const payload = await verifyAppleIdentityToken(parsed.identityToken, cfg);

    const appleUserId = payload.sub;
    if (!appleUserId) {
      throw new UnauthorizedError('Invalid Apple identity token');
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    const isPrivateEmail = payload.is_private_email === true || payload.is_private_email === 'true';

    const knex = await getConnection(null);

    // If this Apple ID is already mapped to a DIFFERENT user, refuse. We
    // don't want a user to steal another user's Apple ID binding.
    const existing = await knex('apple_user_identities')
      .where({ apple_user_id: appleUserId })
      .first<{ tenant: string; user_id: string; apple_refresh_token_enc: string | null } | undefined>();

    if (existing && (existing.tenant !== tenant || existing.user_id !== userId)) {
      return NextResponse.json(
        {
          error: 'already_linked_to_other_user',
          message: 'This Apple ID is already linked to a different Alga PSA account.',
        },
        { status: 409 },
      );
    }

    // Exchange authorization code → refresh token (optional; first-link only).
    let refreshTokenEnc: string | null = existing?.apple_refresh_token_enc ?? null;
    if (parsed.authorizationCode) {
      try {
        const tokens = await exchangeAppleAuthorizationCode(parsed.authorizationCode, cfg);
        if (tokens?.refresh_token) {
          refreshTokenEnc = await encryptAppleRefreshToken(tokens.refresh_token);
        }
      } catch (e) {
        // Non-fatal: user can still sign in; deletion just won't revoke Apple's grant.
        console.warn('[mobile/auth/apple/link] auth code exchange failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await knex('apple_user_identities')
      .insert({
        apple_user_id: appleUserId,
        tenant,
        user_id: userId,
        email,
        is_private_email: isPrivateEmail,
        apple_refresh_token_enc: refreshTokenEnc,
        last_sign_in_at: knex.fn.now(),
      })
      .onConflict('apple_user_id')
      .merge({
        tenant,
        user_id: userId,
        email,
        is_private_email: isPrivateEmail,
        apple_refresh_token_enc: refreshTokenEnc,
        last_sign_in_at: knex.fn.now(),
      });

    return NextResponse.json({
      linked: true,
      email,
      isPrivateEmail,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    if (error instanceof UnauthorizedError) {
      return handleApiError(error);
    }
    if (
      error instanceof Error &&
      /apple identity token|apple signing key|audience|issuer|jwt|malformed/i.test(error.message)
    ) {
      return handleApiError(new UnauthorizedError(error.message));
    }
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const knex = await getConnection(null);

    const rows = await knex('apple_user_identities')
      .where({ tenant, user_id: userId })
      .select<{ apple_user_id: string; apple_refresh_token_enc: string | null }[]>([
        'apple_user_id',
        'apple_refresh_token_enc',
      ]);

    for (const row of rows) {
      if (row.apple_refresh_token_enc) {
        try {
          const plain = await decryptAppleRefreshToken(row.apple_refresh_token_enc);
          if (plain) await revokeAppleRefreshToken(plain);
        } catch (e) {
          console.warn('[mobile/auth/apple/link] Apple refresh token revoke failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (rows.length > 0) {
      await knex('apple_user_identities').where({ tenant, user_id: userId }).del();
    }

    return NextResponse.json({ linked: false });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
