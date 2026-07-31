/**
 * Workflow Task unclaim API Route (EE-only)
 * POST /api/v1/workflows/tasks/[id]/unclaim — release a task the caller has claimed,
 * returning it to the pending pool.
 *
 * No request body. Returns { data: { success: true } }. Errors: 404 if the task does not
 * exist (or in the Community build), 409 if it is not claimed by the caller.
 */

import type { NextRequest } from 'next/server';
import {
  unclaimWorkflowTaskForApi,
  workflowTasksFeatureEnabled,
} from '@alga-psa/user-activities/server/workflow-task-actions';
import { runWithTenant } from '@/lib/db';
import {
  createSuccessResponse,
  handleApiError,
  NotFoundError,
} from '@/lib/api/middleware/apiMiddleware';
import { resolveWorkflowTaskAuthContext, classifyWorkflowTaskError } from '../../utils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveWorkflowTaskAuthContext(req);

    if (!workflowTasksFeatureEnabled) {
      throw new NotFoundError('Workflow tasks are not available');
    }

    const result = await runWithTenant(tenant, () => unclaimWorkflowTaskForApi(user, tenant, id));

    return createSuccessResponse(result);
  } catch (error) {
    return handleApiError(classifyWorkflowTaskError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
