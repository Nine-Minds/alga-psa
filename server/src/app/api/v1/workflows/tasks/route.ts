/**
 * Workflow Tasks API Route (EE-only)
 * GET /api/v1/workflows/tasks — the authenticated caller's workflow task inbox, paginated.
 *
 * Returns tasks assigned to the caller directly or to one of their roles. Items are summary
 * rows (no `formSchema`); fetch a single task via `GET /workflows/tasks/[id]` to get the
 * form schema. Workflow tasks are EE-only — on the Community build the seam returns an empty
 * page (see `@alga-psa/user-activities/server/workflow-task-actions`).
 */

import type { NextRequest } from 'next/server';
import type { TaskQueryParams } from '@shared/workflow/persistence/taskInboxInterfaces';
import { listWorkflowTasksForApi } from '@alga-psa/user-activities/server/workflow-task-actions';
import { runWithTenant } from '@/lib/db';
import { createPaginatedResponse, handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { listWorkflowTasksQuerySchema } from '@/lib/api/schemas/workflowTaskSchemas';
import { resolveWorkflowTaskAuthContext, classifyWorkflowTaskError } from './utils';

export async function GET(req: NextRequest) {
  try {
    const { tenant, user } = await resolveWorkflowTaskAuthContext(req);
    const query = listWorkflowTasksQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );

    const params: TaskQueryParams = { page: query.page, pageSize: query.pageSize };
    if (query.status) {
      // Zod yields the status literals; the model types them as the WorkflowTaskStatus enum.
      params.status = query.status as unknown as TaskQueryParams['status'];
    }

    const result = await runWithTenant(tenant, () => listWorkflowTasksForApi(user, tenant, params));

    return createPaginatedResponse(result.tasks, result.total, result.page, result.pageSize);
  } catch (error) {
    return handleApiError(classifyWorkflowTaskError(error));
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
