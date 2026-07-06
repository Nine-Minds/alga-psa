/**
 * Ad-hoc Activity Done-toggle API Route
 * POST /api/v1/activities/ad-hoc/[id]/done — mark an ad-hoc item done/undone.
 *
 * Body: { done: boolean }. `done=true` sets status='closed', `done=false` sets
 * status='scheduled'. Requires the caller to be an assignee, or hold
 * `user_schedule:update` / `user_schedule:read_all` (enforced inside the package core).
 */

import type { NextRequest } from 'next/server';
import {
  setAdHocActivityDoneForApi,
  getAdHocActivityAsActivityForApi,
} from '@alga-psa/user-activities/server/activity-actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { setAdHocActivityDoneSchema } from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from '../../../utils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = setAdHocActivityDoneSchema.parse(await req.json().catch(() => ({})));

    const updated = await runWithTenant(tenant, async () => {
      await setAdHocActivityDoneForApi(user, tenant, id, body.done);
      return getAdHocActivityAsActivityForApi(tenant, id);
    });

    return createSuccessResponse(updated);
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
