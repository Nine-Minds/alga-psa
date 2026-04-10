import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  createPaginatedResponse,
  ForbiddenError,
} from '@/lib/api/middleware/apiMiddleware';

const parseBooleanParam = (value: string | null): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) {
      throw new ForbiddenError('User context required');
    }

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    const hasAccess = await hasPermission(req.context.user, 'service', 'read', knex);
    if (!hasAccess) {
      throw new ForbiddenError('Permission denied: Cannot read service types');
    }

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;
    const search = url.searchParams.get('search')?.trim() || '';
    const billingMethod = url.searchParams.get('billing_method')?.trim() || '';
    const isActive = parseBooleanParam(url.searchParams.get('is_active'));

    const baseQuery = knex('service_types as st').where({ 'st.tenant': tenant });

    const applyFilters = (query: any) => {
      if (search) {
        query.whereILike('st.name', `%${search}%`);
      }
      if (billingMethod) {
        query.where('st.billing_method', billingMethod);
      }
      if (isActive !== undefined) {
        query.where('st.is_active', isActive);
      }
      return query;
    };

    const countRow = await applyFilters(baseQuery.clone())
      .count('st.id as count')
      .first();
    const total = parseInt(String(countRow?.count ?? '0'), 10) || 0;

    const data = await applyFilters(baseQuery.clone())
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
      .orderBy('st.order_number', 'asc')
      .orderBy('st.name', 'asc')
      .limit(limit)
      .offset(offset);

    return createPaginatedResponse(data, total, page, limit, {
      sort: 'order_number',
      order: 'asc',
      filters: {
        ...(search ? { search } : {}),
        ...(billingMethod ? { billing_method: billingMethod } : {}),
        ...(isActive !== undefined ? { is_active: isActive } : {}),
      },
    }, req);
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
