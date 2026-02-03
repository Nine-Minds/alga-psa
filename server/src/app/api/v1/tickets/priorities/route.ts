/**
 * Ticket Priorities API Route
 * GET /api/v1/tickets/priorities - List ticket priorities for the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
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

    return await runWithTenant(tenantId, async () => {
      const canRead = await hasPermission(user, 'ticket', 'read');
      if (!canRead) throw new ForbiddenError('Permission denied: Cannot read ticket');

      const knex = await getConnection(tenantId);
      const priorities = await knex('priorities')
        .where({ tenant: tenantId })
        .select('priority_id', 'priority_name')
        .orderBy('priority_name', 'asc');

      return createSuccessResponse(priorities);
    });
  } catch (error) {
    return handleApiError(error);
  }
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

