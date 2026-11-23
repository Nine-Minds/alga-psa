/**
 * Ticket Priorities API Route
 * GET /api/v1/tickets/priorities - List ticket priorities for the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import { listPrioritiesForBoard } from '@alga-psa/shared/lib/tickets/boardFieldRules';
import {
  ForbiddenError,
  NotFoundError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant: tenantId, user } = apiRequest.context!;

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied: Cannot read ticket');

      const knex = await getConnection(tenantId);
      const boardId = req.nextUrl.searchParams.get('board_id');

      // `board_id` answers "what may this board's tickets be given?" through the one shared rule
      // (R3): the ITIL family on a board that uses ITIL priorities, the tenant's own elsewhere.
      // Without it the list is every ticket priority, as before, and the caller decides using
      // `is_from_itil_standard`. `itil_priority_level` travels with the row so a caller can find
      // the ITIL priority for an Impact × Urgency result without matching on its name (D8).
      if (boardId) {
        const board = await tenantDb(knex, tenantId)
          .table('boards')
          .where({ board_id: boardId })
          .first('board_id');
        if (!board) throw new NotFoundError('Board not found');

        const priorities = await listPrioritiesForBoard(knex, tenantId, boardId, 'ticket');
        return createSuccessResponse(
          priorities.map((priority) => ({
            priority_id: priority.priority_id,
            priority_name: priority.priority_name,
            is_from_itil_standard: priority.is_from_itil_standard ?? null,
            itil_priority_level: priority.itil_priority_level ?? null,
          })),
          200,
          undefined,
          apiRequest
        );
      }

      const priorities = await tenantDb(knex, tenantId).table('priorities')
        .where({ item_type: 'ticket' })
        .select('priority_id', 'priority_name', 'is_from_itil_standard', 'itil_priority_level')
        .orderBy('priority_name', 'asc');

      return createSuccessResponse(priorities, 200, undefined, apiRequest);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
