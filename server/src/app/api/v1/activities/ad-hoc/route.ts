/**
 * Ad-hoc Activities API Route
 * POST /api/v1/activities/ad-hoc — create a personal ad-hoc to-do (self-assigned).
 *
 * Times are optional; when both are supplied the end must be after the start. Gated by
 * `user_schedule:read` (enforced inside the package core).
 */

import type { NextRequest } from 'next/server';
import { createAdHocActivityForApi } from '@alga-psa/user-activities/actions';
import { runWithTenant } from '@/lib/db';
import { createSuccessResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { createAdHocActivitySchema } from '@/lib/api/schemas/activitySchemas';
import { resolveActivityAuthContext, classifyActivityError } from '../utils';

export async function POST(req: NextRequest) {
  try {
    const { tenant, user } = await resolveActivityAuthContext(req);
    const body = createAdHocActivitySchema.parse(await req.json().catch(() => ({})));

    const created = await runWithTenant(tenant, () =>
      createAdHocActivityForApi(user, tenant, {
        title: body.title,
        notes: body.notes,
        scheduledStart: body.scheduledStart,
        scheduledEnd: body.scheduledEnd,
      }),
    );

    return createSuccessResponse(created, 201);
  } catch (error) {
    return handleApiError(classifyActivityError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
