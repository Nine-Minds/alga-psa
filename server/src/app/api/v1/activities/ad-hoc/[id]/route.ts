/**
 * Ad-hoc Activity by ID API Route
 * PATCH  /api/v1/activities/ad-hoc/[id] — update title / notes / optional times.
 * DELETE /api/v1/activities/ad-hoc/[id] — permanently delete the ad-hoc item.
 *
 * Both require the caller to be an assignee, or hold `user_schedule:update` /
 * `user_schedule:read_all` (enforced inside the package core).
 */

import type { NextRequest } from 'next/server';
import {
  updateAdHocActivityForApi,
  getAdHocActivityAsActivityForApi,
  deleteAdHocActivityForApi,
} from '@alga-psa/user-activities/server/activity-actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { updateAdHocActivitySchema } from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from '../../utils';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = updateAdHocActivitySchema.parse(await req.json().catch(() => ({})));

    const updated = await runWithTenant(tenant, async () => {
      await updateAdHocActivityForApi(user, tenant, id, {
        title: body.title,
        notes: body.notes,
        scheduledStart: body.scheduledStart,
        scheduledEnd: body.scheduledEnd,
      });
      return getAdHocActivityAsActivityForApi(tenant, id);
    });

    return createSuccessResponse(updated);
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveActivityAuthContext(req);

    await runWithTenant(tenant, () => deleteAdHocActivityForApi(user, tenant, id));

    return createSuccessResponse(null, 204);
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
