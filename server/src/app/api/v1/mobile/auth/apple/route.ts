import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { getConnection } from '@/lib/db/db';
import { issueMobileOtt } from '@/lib/mobileAuth/mobileAuthService';
import {
  encryptAppleRefreshToken,
  exchangeAppleAuthorizationCode,
  getAppleSignInConfig,
  verifyAppleIdentityToken,
} from '@/lib/mobileAuth/appleSignIn';
import { enforceMobileOttIssueLimit } from '@/lib/security/mobileAuthRateLimiting';

/**
 * POST /api/v1/mobile/auth/apple
 *
 * Sign in with Apple — App Store guideline 4.8. The iOS client performs the
 * native SIWA flow and forwards the identity token (+ one-shot authorization
 * code on first sign-in). We:
 *
 *   1. Verify the identity token against Apple's JWKS.
 *   2. Look up a matching Alga user (by previously-linked Apple `sub`, or
 *      by verified email as a one-time link).
 *   3. If found: issue an OTT that the client can exchange for a mobile
 *      session via /api/v1/mobile/auth/exchange. On first link we also
 *      exchange the authorization code for a refresh token and store it
 *      encrypted so account-deletion can revoke the grant.
 *   4. If no user matches: return 404 with an explanatory error — self-signup
 *      is handled separately via the Solo IAP CreateWorkspace flow.
 */

const appleSignInSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  state: z.string().min(1),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

type IdentityRow = {
  apple_user_id: string;
  tenant: string;
  user_id: string;
  email: string | null;
  apple_refresh_token_enc: string | null;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = appleSignInSchema.parse(body);

    const cfg = await getAppleSignInConfig();
    const payload = await verifyAppleIdentityToken(parsed.identityToken, cfg);

    const appleUserId = payload.sub;
    if (!appleUserId) {
      throw new UnauthorizedError('Invalid Apple identity token');
    }

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const isPrivateEmail = payload.is_private_email === true || payload.is_private_email === 'true';

    const knex = await getConnection(null);

    // 1. Previously-linked identity takes priority (stable across email relay rotations).
    let identity = (await knex('apple_user_identities')
      .where({ apple_user_id: appleUserId })
      .first()) as IdentityRow | undefined;

    // 2. Otherwise try to link by verified email, but only if exactly one user matches.
    if (!identity && email && emailVerified) {
      const matches = await knex('users')
        .whereRaw('LOWER(email) = ?', [email])
        .where({ is_inactive: false })
        .where({ user_type: 'internal' })
        .select<{ user_id: string; tenant: string }[]>(['user_id', 'tenant']);

      if (matches.length === 1) {
        const match = matches[0];
        // Exchange auth code for refresh token (first link only).
        let refreshTokenEnc: string | null = null;
        if (parsed.authorizationCode) {
          try {
            const tokens = await exchangeAppleAuthorizationCode(parsed.authorizationCode, cfg);
            if (tokens?.refresh_token) {
              refreshTokenEnc = await encryptAppleRefreshToken(tokens.refresh_token);
            }
          } catch (e) {
            // Non-fatal: the user can still sign in; deletion just won't revoke Apple's grant.
            console.warn('[mobile/auth/apple] authorization code exchange failed', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        await knex('apple_user_identities')
          .insert({
            apple_user_id: appleUserId,
            tenant: match.tenant,
            user_id: match.user_id,
            email,
            is_private_email: isPrivateEmail,
            apple_refresh_token_enc: refreshTokenEnc,
            last_sign_in_at: knex.fn.now(),
          })
          .onConflict('apple_user_id')
          .merge({
            email,
            is_private_email: isPrivateEmail,
            apple_refresh_token_enc: refreshTokenEnc,
            last_sign_in_at: knex.fn.now(),
          });

        identity = {
          apple_user_id: appleUserId,
          tenant: match.tenant,
          user_id: match.user_id,
          email,
          apple_refresh_token_enc: refreshTokenEnc,
        };
      }
    }

    if (!identity) {
      return NextResponse.json(
        {
          error: 'no_account',
          message:
            'No Alga PSA account is linked to this Apple ID. If you have a Solo plan, subscribe from the "Create a new workspace" screen; otherwise ask your workspace admin to provision an account for your email.',
        },
        { status: 404 },
      );
    }

    await enforceMobileOttIssueLimit(`${identity.tenant}:${identity.user_id}:${getClientIp(req)}`);

    // Opportunistically upgrade stored refresh token on subsequent sign-ins
    // where the client sent a fresh authorization code.
    if (parsed.authorizationCode && !identity.apple_refresh_token_enc) {
      try {
        const tokens = await exchangeAppleAuthorizationCode(parsed.authorizationCode, cfg);
        if (tokens?.refresh_token) {
          const enc = await encryptAppleRefreshToken(tokens.refresh_token);
          await knex('apple_user_identities')
            .where({ apple_user_id: appleUserId })
            .update({ apple_refresh_token_enc: enc });
        }
      } catch (e) {
        console.warn('[mobile/auth/apple] refresh token upgrade failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await knex('apple_user_identities')
      .where({ apple_user_id: appleUserId })
      .update({ last_sign_in_at: knex.fn.now() });

    const { ott, expiresAtMs } = await issueMobileOtt({
      tenantId: identity.tenant,
      userId: identity.user_id,
      state: parsed.state,
      metadata: {
        source: 'apple_sign_in',
        isPrivateEmail,
      },
    });

    return NextResponse.json({
      ott,
      state: parsed.state,
      expiresInSec: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    if (error instanceof UnauthorizedError) {
      return handleApiError(error);
    }
    // Signature / JWKS failures land here — treat as unauthorized, not 500.
    if (error instanceof Error && /apple identity token|apple signing key|audience|issuer|jwt/i.test(error.message)) {
      return handleApiError(new UnauthorizedError(error.message));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
