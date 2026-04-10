import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  createSuccessResponse,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/api/middleware/apiMiddleware';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) {
      throw new ForbiddenError('User context required');
    }

    if (!UUID_PATTERN.test(id)) {
      throw new ValidationError('Invalid service type ID format');
    }

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    const hasAccess = await hasPermission(req.context.user, 'service', 'read', knex);
    if (!hasAccess) {
      throw new ForbiddenError('Permission denied: Cannot read service types');
    }

    const serviceType = await knex('service_types as st')
      .where({ 'st.id': id, 'st.tenant': tenant })
      .select(
        'st.id',
        'st.tenant',
        'st.name',
        'st.billing_method',
        'st.is_active',
        'st.description',
        'st.order_number',
        'st.created_at',
        'st.updated_at',
      )
      .first();

    if (!serviceType) {
      throw new NotFoundError('Service type not found');
    }

    return createSuccessResponse(serviceType, 200, undefined, req);
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
