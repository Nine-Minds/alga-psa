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
import { tenantDb, withTransaction } from '@alga-psa/db';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { findReactionComment } from '@alga-psa/tickets/lib/commentReactionResolver';
import { isUuidShaped } from '@alga-psa/validation';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

/** The errors `authorizeTicketRecordAccess` throws for a denial (same mapping as /api/tickets/[id]/email-html). */
function deniedStatus(error: unknown): 403 | 404 | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'Ticket not found') return 404;
  if (error.message.startsWith('Permission denied')) return 403;
  return null;
}

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
): Promise<NextResponse> => {
  try {
    const { id: ticketId, commentId } = await params;
    if (!isUuidShaped(ticketId) || !isUuidShaped(commentId)) {
      throw new ValidationError('Invalid ticket or comment id');
    }
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
        const db = tenantDb(trx, tenantId);

        try {
          await authorizeTicketRecordAccess({ trx, tenant: tenantId, user, ticketId, action: 'update' });
        } catch (error) {
          const status = deniedStatus(error);
          if (status === 404) throw new NotFoundError((error as Error).message);
          if (status === 403) throw new ForbiddenError((error as Error).message);
          throw error;
        }

        // Missing comment and comment under another ticket are the same 404.
        const comment = await findReactionComment(trx, tenantId, commentId, ticketId);
        if (!comment) throw new NotFoundError('Comment not found');

        const existing = await db.table('comment_reactions')
          .where({ comment_id: commentId, user_id: userId, emoji })
          .first();

        if (existing) {
          await db.table('comment_reactions')
            .where({ reaction_id: existing.reaction_id })
            .del();
          return { added: false };
        }

        await db.table('comment_reactions')
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
