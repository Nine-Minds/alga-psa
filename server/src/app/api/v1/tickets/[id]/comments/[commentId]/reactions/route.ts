/**
 * Ticket Comment Reaction Toggle API Route
 * POST /api/v1/tickets/{id}/comments/{commentId}/reactions - Toggle a reaction
 *   Body: { emoji: string }
 *   Returns: { added: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from '@/lib/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import { validateEmoji } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import {
  ForbiddenError,
  UnauthorizedError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
): Promise<NextResponse> => {
  try {
    const { commentId } = await params;
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) throw new UnauthorizedError('API key required');

    let tenantId = req.headers.get('x-tenant-id');
    let keyRecord;

    if (tenantId) {
      keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
    } else {
      keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (keyRecord) tenantId = keyRecord.tenant;
    }

    if (!keyRecord || !tenantId) throw new UnauthorizedError('Invalid API key');

    const user = await findUserByIdForApi(keyRecord.user_id, tenantId);
    if (!user) throw new UnauthorizedError('User not found');

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied');

      const body = await req.json();
      const emoji: string = body.emoji;
      validateEmoji(emoji);

      const knex = await getConnection(tenantId);
      const userId = keyRecord.user_id;

      const result = await withTransaction(knex, async (trx) => {
        const existing = await trx('comment_reactions')
          .where({ tenant: tenantId, comment_id: commentId, user_id: userId, emoji })
          .first();

        if (existing) {
          await trx('comment_reactions')
            .where({ tenant: tenantId, reaction_id: existing.reaction_id })
            .del();
          return { added: false };
        }

        await trx('comment_reactions')
          .insert({ tenant: tenantId, comment_id: commentId, user_id: userId, emoji });

        return { added: true };
      });

      return createSuccessResponse(result);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
