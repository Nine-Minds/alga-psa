/**
 * Ticket Priorities API Route
 * GET /api/v1/tickets/priorities - List ticket priorities for the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import { runWithTenant } from '@/lib/db';
import { hasPermission } from '@/lib/auth/rbac';
import { getConnection } from '@/lib/db/db';
import {
  ForbiddenError,
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
      const priorities = await knex('priorities')
        .where({ tenant: tenantId, item_type: 'ticket' })
        .select('priority_id', 'priority_name')
        .orderBy('priority_name', 'asc');

      return createSuccessResponse(priorities, 200, undefined, apiRequest);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
