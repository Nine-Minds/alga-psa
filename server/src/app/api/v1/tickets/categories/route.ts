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
import { listCategoriesForBoard } from '@alga-psa/shared/lib/tickets/boardFieldRules';
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
      const db = tenantDb(knex, tenantId);

      // R2: a board's categories are the rows it owns, ITIL board or not — every ITIL board owns
      // its own copy of the standard set (D9). Must match getTicketCategoriesByBoard
      // (ticketCategoryActions) and the form hydration in optimizedTicketActions, which call the
      // same shared lister.
      const categories = query.board_id
        ? (await listCategoriesForBoard(knex, tenantId, query.board_id)).map((category) => ({
            category_id: category.category_id,
            category_name: category.category_name,
            parent_category: category.parent_category ?? null,
            board_id: category.board_id ?? null,
            display_order: (category as { display_order?: number | null }).display_order ?? null,
          }))
        : await db.table('categories')
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
