/**
 * Workflow Task detail API Route (EE-only)
 * GET /api/v1/workflows/tasks/[id] — full detail for a single workflow task.
 *
 * The response includes `formSchema` ({ jsonSchema, uiSchema?, defaultValues? }) so the
 * mobile client can classify the form as simple (native completion) vs complex (web
 * deep-link), alongside status, priority, due date, assigned roles/users, description and
 * contextData. On the Community build (no workflow tasks) this returns 404.
 */

import type { NextRequest } from 'next/server';
import {
  getWorkflowTaskForApi,
  workflowTasksFeatureEnabled,
} from '@alga-psa/user-activities/server/workflow-task-actions';
import { runWithTenant } from '@/lib/db';
import {
  createSuccessResponse,
  handleApiError,
  NotFoundError,
} from '@/lib/api/middleware/apiMiddleware';
import { resolveWorkflowTaskAuthContext, classifyWorkflowTaskError } from '../utils';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveWorkflowTaskAuthContext(req);

    if (!workflowTasksFeatureEnabled) {
      throw new NotFoundError('Workflow tasks are not available');
    }

    const task = await runWithTenant(tenant, () => getWorkflowTaskForApi(user, tenant, id));

    return createSuccessResponse(task);
  } catch (error) {
    return handleApiError(classifyWorkflowTaskError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
