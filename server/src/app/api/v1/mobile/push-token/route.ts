import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { handleApiError, ValidationError, UnauthorizedError } from '@/lib/api/middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
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

async function authenticate(req: NextRequest): Promise<{ tenant: string; userId: string }> {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) throw new UnauthorizedError('API key required');

  const tenantId = req.headers.get('x-tenant-id');
  let keyRecord;

  if (tenantId) {
    keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
  } else {
    keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  }

  if (!keyRecord) throw new UnauthorizedError('Invalid API key');

  return { tenant: keyRecord.tenant, userId: keyRecord.user_id };
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const parsed = unregisterSchema.parse(body);

    await deactivatePushToken(tenant, userId, parsed.deviceId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(new ValidationError('Validation failed', error.errors));
    }
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
