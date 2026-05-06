import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
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

const postSchema = z.object({
  mutedUserId: z.string().uuid(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req, { allowBearerToken: true });
    const { tenant, userId } = apiRequest.context!;
    const knex = await getConnection(null);
    const rows = await knex('user_content_mutes')
      .where({ tenant, user_id: userId })
      .select<{ muted_user_id: string }[]>(['muted_user_id']);
    return appendRateLimitHeaders(
      NextResponse.json({ mutedUserIds: rows.map((r) => r.muted_user_id) }),
      apiRequest,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req, { allowBearerToken: true });
    const { tenant, userId } = apiRequest.context!;
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
