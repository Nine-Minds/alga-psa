import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/api/middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getConnection } from '@/lib/db/db';

/**
 * DELETE /api/v1/mobile/moderation/mutes/:userId
 *
 * Remove a mute. Paired with GET/POST /mutes. See the parent route for the
 * broader rationale and guideline-1.2 context.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  try {
    const { tenant, userId } = await authenticate(req);
    const { userId: mutedUserId } = await params;

    if (!UUID_RE.test(mutedUserId)) {
      return handleApiError(new ValidationError('Invalid user id'));
    }

    const knex = await getConnection(null);
    await knex('user_content_mutes')
      .where({ tenant, user_id: userId, muted_user_id: mutedUserId })
      .del();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
