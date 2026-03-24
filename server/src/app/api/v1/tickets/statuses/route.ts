/**
 * Ticket Statuses API Route
 * GET /api/v1/tickets/statuses - List board-owned ticket statuses for the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from '@/lib/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import {
  ForbiddenError,
  UnauthorizedError,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

const ticketStatusesQuerySchema = z.object({
  board_id: z.string().uuid().optional(),
});

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  try {
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

    const query = ticketStatusesQuerySchema.parse({
      board_id: new URL(req.url).searchParams.get('board_id') ?? undefined,
    });

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied: Cannot read ticket');

      const knex = await getConnection(tenantId);
      const statuses = await knex('statuses')
        .where({
          tenant: tenantId,
          status_type: 'ticket',
        })
        .whereNotNull('board_id')
        .modify((queryBuilder) => {
          if (query.board_id) {
            queryBuilder.andWhere({ board_id: query.board_id });
          }
        })
        .select('status_id', 'board_id', 'name', 'is_closed', 'is_default', 'order_number')
        .orderBy('board_id', 'asc')
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc');

      return createSuccessResponse(statuses);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
