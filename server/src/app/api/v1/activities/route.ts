/**
 * User Activities API Route
 * GET /api/v1/activities — unified, paginated activity list for the authenticated user.
 *
 * Delegates to the user-activities package's identity-explicit core
 * (`fetchUserActivitiesForApi`), which fans out across tickets / project tasks / schedule /
 * ad-hoc / workflow tasks / time entries / notifications and surfaces ad-hoc items
 * independent of the schedule date window (no windowing is re-implemented here).
 */

import type { NextRequest } from 'next/server';
import type { ActivityFilters } from '@alga-psa/types';
import { fetchUserActivitiesForApi } from '@alga-psa/user-activities/actions';
import { runWithTenant } from '@/lib/db';
import { createPaginatedResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { listActivitiesQuerySchema } from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from './utils';

export async function GET(req: NextRequest) {
  try {
    const { tenant, user } = await resolveActivityAuthContext(req);
    const query = listActivitiesQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );

    const filters: ActivityFilters = {};
    if (query.type) filters.types = query.type;
    if (query.search) filters.search = query.search;
    if (query.status === 'open') filters.isClosed = false;
    else if (query.status === 'closed') filters.isClosed = true;
    if (query.dateStart) filters.dateRangeStart = query.dateStart;
    if (query.dateEnd) filters.dateRangeEnd = query.dateEnd;

    const result = await runWithTenant(tenant, () =>
      fetchUserActivitiesForApi(user, tenant, filters, query.page, query.pageSize),
    );

    return createPaginatedResponse(
      result.activities,
      result.totalCount,
      result.pageNumber,
      result.pageSize,
    );
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
