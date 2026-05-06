import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { upsertPushToken, deactivatePushToken } from '@/lib/pushNotifications/pushTokenService';

const registerSchema = z.object({
  expoPushToken: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().optional(),
});

const unregisterSchema = z.object({
  deviceId: z.string().min(1),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant, userId } = apiRequest.context!;
    const body = await req.json().catch(() => ({}));
    const parsed = registerSchema.parse(body);

    await upsertPushToken(
      tenant,
      userId,
      parsed.deviceId,
      parsed.expoPushToken,
      parsed.platform,
      parsed.appVersion,
    );

    return appendRateLimitHeaders(NextResponse.json({ ok: true }), apiRequest);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant, userId } = apiRequest.context!;
    const body = await req.json().catch(() => ({}));
    const parsed = unregisterSchema.parse(body);

    await deactivatePushToken(tenant, userId, parsed.deviceId);

    return appendRateLimitHeaders(NextResponse.json({ ok: true }), apiRequest);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
