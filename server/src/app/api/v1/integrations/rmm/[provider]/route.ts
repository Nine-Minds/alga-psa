/**
 * RMM Integration API
 * GET /api/v1/integrations/rmm/{provider} — status of one integration.
 */
import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  createSuccessResponse,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api/middleware/apiMiddleware';
import { readRmmIntegrationStatuses } from '@alga-psa/integrations/lib/rmm/rmmIntegrationStatus';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) throw new ForbiddenError('User context required');

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    if (!(await hasPermission(req.context.user, 'system_settings', 'read', knex))) {
      throw new ForbiddenError('Permission denied: Cannot read RMM integrations');
    }

    const statuses = await readRmmIntegrationStatuses(knex, tenant!);
    const status = statuses[provider];
    if (!status) throw new NotFoundError(`No ${provider} integration is configured for this tenant`);

    return createSuccessResponse(status);
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
