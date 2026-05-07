import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { getConnection } from '@/lib/db/db';

/**
 * DELETE /api/v1/mobile/moderation/mutes/:userId
 *
 * Remove a mute. Paired with GET/POST /mutes. See the parent route for the
 * broader rationale and guideline-1.2 context.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  try {
    const apiRequest = await authenticateApiKeyRequest(req, { allowBearerToken: true });
    const { tenant, userId } = apiRequest.context!;
    const { userId: mutedUserId } = await params;

    if (!UUID_RE.test(mutedUserId)) {
      return handleApiError(new ValidationError('Invalid user id'));
    }

    const knex = await getConnection(null);
    await knex('user_content_mutes')
      .where({ tenant, user_id: userId, muted_user_id: mutedUserId })
      .del();

    return appendRateLimitHeaders(NextResponse.json({ ok: true }), apiRequest);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
