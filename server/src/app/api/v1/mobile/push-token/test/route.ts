/**
 * POST /api/v1/mobile/push-token/test
 *
 * Sends a test push to every active device of the calling user and reports
 * the per-device outcome. Exists so a self-hosted operator can tell from the
 * app whether (a) this device is registered with this server and (b) the
 * server can reach Expo's push service.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { getActivePushTokensForUser } from '@/lib/pushNotifications/pushTokenService';
import { buildTestPushMessage, sendPushNotifications } from '@/lib/pushNotifications/expoPushService';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant, userId } = apiRequest.context!;

    const tokens = await getActivePushTokensForUser(tenant, userId);
    if (tokens.length === 0) {
      return appendRateLimitHeaders(
        NextResponse.json({ ok: false, reason: 'no_active_tokens', deviceCount: 0, results: [] }),
        apiRequest,
      );
    }

    const serverHost = new URL(req.url).host;
    const sent = await sendPushNotifications(
      tokens.map((t) => buildTestPushMessage(t.expo_push_token, serverHost)),
      tenant,
    );

    const results = tokens.map((t) => {
      const outcome = sent.find((r) => r.to === t.expo_push_token);
      return { platform: t.platform, status: outcome?.status ?? 'error', error: outcome?.error ?? null };
    });
    const ok = results.some((r) => r.status === 'ok');

    return appendRateLimitHeaders(
      NextResponse.json({ ok, reason: ok ? undefined : 'send_failed', deviceCount: tokens.length, results }),
      apiRequest,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
