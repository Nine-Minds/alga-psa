/**
 * Workflow Task complete API Route (EE-only)
 * POST /api/v1/workflows/tasks/[id]/complete — submit the task's form and complete it.
 *
 * Body: { formData: Record<string, unknown>, comments?: string }. The form payload is
 * validated server-side against the task's JSON Schema inside `submitTaskForm`
 * (formRegistry.validateFormData); validation failures surface as 400 with the schema
 * errors in `details`. Returns { data: { success: true } }. On the Community build (no
 * workflow tasks) this returns 404.
 */

import type { NextRequest } from 'next/server';
import {
  completeWorkflowTaskForApi,
  workflowTasksFeatureEnabled,
} from '@alga-psa/user-activities/server/workflow-task-actions';
import { runWithTenant } from '@/lib/db';
import {
  createSuccessResponse,
  handleApiError,
  NotFoundError,
} from '@/lib/api/middleware/apiMiddleware';
import { completeWorkflowTaskSchema } from '@/lib/api/schemas/workflowTaskSchemas';
import { resolveWorkflowTaskAuthContext, classifyWorkflowTaskError } from '../../utils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { tenant, user } = await resolveWorkflowTaskAuthContext(req);

    if (!workflowTasksFeatureEnabled) {
      throw new NotFoundError('Workflow tasks are not available');
    }

    const body = completeWorkflowTaskSchema.parse(await req.json().catch(() => ({})));

    const result = await runWithTenant(tenant, () =>
      completeWorkflowTaskForApi(user, tenant, {
        taskId: id,
        formData: body.formData,
        comments: body.comments,
      }),
    );

    return createSuccessResponse(result);
  } catch (error) {
    return handleApiError(classifyWorkflowTaskError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
