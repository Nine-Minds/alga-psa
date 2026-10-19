/**
 * Ticket Categories API Route
 * GET /api/v1/tickets/categories - List board-scoped ticket categories for the tenant
 *
 * Sibling of /tickets/statuses and /tickets/priorities: a ticket:read surface for
 * clients that classify tickets (mobile) rather than configure them. The
 * /categories/ticket CRUD surface stays on ticket_settings:read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { runWithTenant } from '@/lib/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import {
  ForbiddenError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

const ticketCategoriesQuerySchema = z.object({
  board_id: z.string().uuid().optional(),
});

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const apiRequest = await authenticateApiKeyRequest(req);
    const { tenant: tenantId, user } = apiRequest.context!;

    const query = ticketCategoriesQuerySchema.parse({
      board_id: new URL(req.url).searchParams.get('board_id') ?? undefined,
    });

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied: Cannot read ticket');

      const knex = await getConnection(tenantId);
      const categories = await tenantDb(knex, tenantId).table('categories')
        .modify((queryBuilder) => {
          if (query.board_id) {
            queryBuilder.where({ board_id: query.board_id });
          }
        })
        .select('category_id', 'category_name', 'parent_category', 'board_id', 'display_order')
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc');

      return createSuccessResponse(categories, 200, undefined, apiRequest);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
