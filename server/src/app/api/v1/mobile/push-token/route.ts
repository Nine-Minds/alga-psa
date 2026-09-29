import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { upsertPushToken, deactivatePushToken, updatePushPriorityThreshold } from '@/lib/pushNotifications/pushTokenService';

const priorityThresholdSchema = z.enum(['low', 'normal', 'high']);

const registerSchema = z.object({
  expoPushToken: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().optional(),
  // Lowest notification priority this device wants pushed; omitted = keep current.
  priorityThreshold: priorityThresholdSchema.optional(),
});

const thresholdSchema = z.object({
  deviceId: z.string().min(1),
  priorityThreshold: priorityThresholdSchema,
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
      parsed.priorityThreshold,
    );

    return appendRateLimitHeaders(NextResponse.json({ ok: true }), apiRequest);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

/** Change only this device's push priority threshold (Settings → "Push me for"). */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant, userId } = apiRequest.context!;
    const body = await req.json().catch(() => ({}));
    const parsed = thresholdSchema.parse(body);

    const updated = await updatePushPriorityThreshold(tenant, userId, parsed.deviceId, parsed.priorityThreshold);
    if (!updated) {
      return appendRateLimitHeaders(
        NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No push registration for this device' } }, { status: 404 }),
        apiRequest,
      );
    }

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
