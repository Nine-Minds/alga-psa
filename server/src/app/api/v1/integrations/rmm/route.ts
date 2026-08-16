/**
 * RMM Integrations API
 * GET /api/v1/integrations/rmm — status of every configured RMM integration,
 * including whether a recurring device sync is scheduled and when it last ran.
 */
import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import { createSuccessResponse, ForbiddenError } from '@/lib/api/middleware/apiMiddleware';
import { readRmmIntegrationStatuses } from '@alga-psa/integrations/lib/rmm/rmmIntegrationStatus';

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) throw new ForbiddenError('User context required');

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    if (!(await hasPermission(req.context.user, 'system_settings', 'read', knex))) {
      throw new ForbiddenError('Permission denied: Cannot read RMM integrations');
    }

    const statuses = await readRmmIntegrationStatuses(knex, tenant!);
    return createSuccessResponse(Object.values(statuses));
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
