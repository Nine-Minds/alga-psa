/**
 * Custom Activity Group Items API Route
 * POST   /api/v1/activities/groups/items — move an activity into a group at a position.
 * DELETE /api/v1/activities/groups/items — remove an activity from all of the caller's groups.
 *
 * Backs mobile drag-to-organize of the "My groups" view. Groups themselves are still
 * created/renamed/deleted in the web app; these endpoints only change membership/order.
 * Scoped to the caller's own groups and gated by `user_schedule:read` (enforced in the
 * package core).
 */

import type { NextRequest } from 'next/server';
import {
  moveActivityToGroupForApi,
  removeActivityFromGroupsForApi,
} from '@alga-psa/user-activities/server/activity-actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import {
  moveActivityToGroupSchema,
  removeActivityFromGroupSchema,
} from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from '../../utils';

export async function POST(req: NextRequest) {
  try {
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = moveActivityToGroupSchema.parse(await req.json().catch(() => ({})));

    await runWithTenant(tenant, () =>
      moveActivityToGroupForApi(
        user,
        tenant,
        body.activityId,
        body.activityType,
        body.groupId,
        body.sortOrder,
      ),
    );

    return createSuccessResponse({ moved: true });
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = removeActivityFromGroupSchema.parse(await req.json().catch(() => ({})));

    await runWithTenant(tenant, () =>
      removeActivityFromGroupsForApi(user, tenant, body.activityId, body.activityType),
    );

    return createSuccessResponse({ removed: true });
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
