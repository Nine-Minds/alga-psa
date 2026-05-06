/**
 * Ticket Comment Reaction Toggle API Route
 * POST /api/v1/tickets/{id}/comments/{commentId}/reactions - Toggle a reaction
 *   Body: { emoji: string }
 *   Returns: { added: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { runWithTenant } from '@/lib/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import { validateEmoji } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import {
  ForbiddenError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
): Promise<NextResponse> => {
  try {
    const { commentId } = await params;
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant: tenantId, userId, user } = apiRequest.context!;

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied');

      const body = await req.json();
      const emoji: string = body.emoji;
      validateEmoji(emoji);

      const knex = await getConnection(tenantId);

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

      return createSuccessResponse(result, 200, undefined, apiRequest);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
