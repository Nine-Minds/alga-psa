import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/db/db';
import {
  decryptAppleRefreshToken,
  revokeAppleRefreshToken,
  verifyAppleServerNotification,
  type AppleServerNotificationEvent,
} from '@/lib/mobileAuth/appleSignIn';

/**
 * POST /api/v1/mobile/auth/apple/notifications
 *
 * Sign in with Apple server-to-server notifications endpoint. Apple posts
 * here when a user revokes consent, deletes their Apple ID, or toggles
 * private-relay email forwarding. Registered under the Services ID in the
 * Apple Developer portal.
 *
 * No API key — the JWS signature is the authentication. We verify it with
 * Apple's published signing keys and audience = APPLE_SIGN_IN_BUNDLE_ID.
 *
 * Apple retries on non-2xx, so:
 *   - Signature / payload malformed → 401 (don't retry; won't get better)
 *   - Event for an Apple `sub` we don't have → 200 (nothing to do; ack)
 *   - DB / unexpected error → 500 (Apple will retry; our operations are
 *     idempotent so retries are safe)
 */

async function handleEvent(event: AppleServerNotificationEvent): Promise<void> {
  const knex = await getConnection(null);

  switch (event.type) {
    case 'consent-revoked':
    case 'account-delete': {
      // User revoked our app from their Apple ID (or deleted the Apple ID
      // itself). Remove our mapping and revoke the refresh token we hold.
      // We do NOT deactivate the Alga user — they may have other sign-in
      // methods (Google/Microsoft SSO). If Apple was their only login, they
      // can still reach the web to recover.
      const rows = await knex('apple_user_identities')
        .where({ apple_user_id: event.sub })
        .select<{ apple_refresh_token_enc: string | null }[]>(['apple_refresh_token_enc']);

      for (const row of rows) {
        if (!row.apple_refresh_token_enc) continue;
        try {
          const plain = await decryptAppleRefreshToken(row.apple_refresh_token_enc);
          if (plain) await revokeAppleRefreshToken(plain);
        } catch (e) {
          console.warn('[mobile/auth/apple/notifications] revoke failed', {
            event: event.type,
            sub: event.sub,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (rows.length > 0) {
        await knex('apple_user_identities').where({ apple_user_id: event.sub }).del();
      }
      return;
    }

    case 'email-disabled': {
      await knex('apple_user_identities')
        .where({ apple_user_id: event.sub })
        .update({ email_forwarding_disabled: true });
      return;
    }

    case 'email-enabled': {
      await knex('apple_user_identities')
        .where({ apple_user_id: event.sub })
        .update({ email_forwarding_disabled: false });
      return;
    }

    default: {
      // Unknown event type — log and ignore. Apple may add new types;
      // returning 200 is better than retrying forever.
      console.warn('[mobile/auth/apple/notifications] unknown event type', {
        type: (event as { type?: string }).type,
        sub: event.sub,
      });
      return;
    }
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const payload = body?.payload;
  if (typeof payload !== 'string' || payload.length === 0) {
    return NextResponse.json({ error: 'missing_payload' }, { status: 400 });
  }

  let event: AppleServerNotificationEvent;
  try {
    const verified = await verifyAppleServerNotification(payload);
    event = verified.events;
  } catch (e) {
    console.warn('[mobile/auth/apple/notifications] JWS verification failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  try {
    await handleEvent(event);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[mobile/auth/apple/notifications] handler failed', {
      type: event.type,
      sub: event.sub,
      error: e instanceof Error ? e.message : String(e),
    });
    // Return 500 so Apple retries. Handlers are idempotent.
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
