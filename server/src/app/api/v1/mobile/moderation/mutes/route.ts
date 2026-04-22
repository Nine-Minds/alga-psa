import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getConnection } from '@/lib/db/db';

/**
 * /api/v1/mobile/moderation/mutes
 *
 * GET   — list user IDs the caller has muted.
 * POST  — add a mute (body: { mutedUserId }).
 *
 * Mutes are per-tenant and one-directional: muting a user only hides their
 * content from the caller, it doesn't block them from seeing the caller's.
 * App Store guideline 1.2 calls this a block list; we expose it as "mute" in
 * the UI because it scopes to the mobile view only.
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
  mutedUserId: z.string().uuid(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const knex = await getConnection(null);
    const rows = await knex('user_content_mutes')
      .where({ tenant, user_id: userId })
      .select<{ muted_user_id: string }[]>(['muted_user_id']);
    return NextResponse.json({ mutedUserIds: rows.map((r) => r.muted_user_id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.parse(body);

    if (parsed.mutedUserId === userId) {
      return handleApiError(new ValidationError('You cannot mute yourself'));
    }

    const knex = await getConnection(null);
    await knex('user_content_mutes')
      .insert({
        tenant,
        user_id: userId,
        muted_user_id: parsed.mutedUserId,
      })
      .onConflict(['tenant', 'user_id', 'muted_user_id'])
      .ignore();

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
