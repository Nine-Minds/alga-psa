/**
 * Workflow Task claim API Route (EE-only)
 * POST /api/v1/workflows/tasks/[id]/claim — claim a pending task for the caller.
 *
 * No request body. Returns { data: { success: true } }. Errors: 404 if the task does not
 * exist (or in the Community build), 409 if it is already claimed by another user or is not
 * in a claimable state.
 */

import type { NextRequest } from 'next/server';
import {
  claimWorkflowTaskForApi,
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

    const result = await runWithTenant(tenant, () => claimWorkflowTaskForApi(user, tenant, id));

    return createSuccessResponse(result);
  } catch (error) {
    return handleApiError(classifyWorkflowTaskError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
