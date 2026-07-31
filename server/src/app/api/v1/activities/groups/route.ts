/**
 * User Activity Groups API Route
 * GET /api/v1/activities/groups — the caller's custom activity groups (read-only).
 *
 * Returns each group (sorted by sort_order) with its ordered items
 * ({ activityId, activityType, sortOrder }). The mobile "My groups" view buckets the
 * unified activity list into these groups locally. Optional `?targetUserId=` returns
 * another user's groups when the caller holds user_schedule:update / read_all (enforced
 * in the package core). Group editing stays in the web app.
 */

import type { NextRequest } from 'next/server';
import { getUserActivityGroupsForApi } from '@alga-psa/user-activities/server/activity-actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { resolveActivityAuthContext, classifyActivityError } from '../utils';

export async function GET(req: NextRequest) {
  try {
    const { tenant, user } = await resolveActivityAuthContext(req);
    const targetUserId = new URL(req.url).searchParams.get('targetUserId') ?? undefined;

    const groups = await runWithTenant(tenant, () =>
      getUserActivityGroupsForApi(user, tenant, targetUserId),
    );

    return createSuccessResponse(groups);
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
