/**
 * Custom Activity Group Reorder API Route
 * PATCH /api/v1/activities/groups/[groupId]/items — persist the full ordered membership of
 * a group after a drag-to-reorder. Pass every item as it should appear; each row's
 * sort_order is set to its position.
 *
 * Scoped to the caller's own groups and gated by `user_schedule:read` (enforced in the
 * package core).
 */

import type { NextRequest } from 'next/server';
import { reorderActivitiesInGroupForApi } from '@alga-psa/user-activities/server/activity-actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { reorderActivitiesInGroupSchema } from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from '../../../utils';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const { groupId } = await params;
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = reorderActivitiesInGroupSchema.parse(await req.json().catch(() => ({})));

    await runWithTenant(tenant, () =>
      reorderActivitiesInGroupForApi(user, tenant, groupId, body.items),
    );

    return createSuccessResponse({ reordered: true });
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
