/**
 * Project Task Checklist API Routes
 * GET /api/v1/projects/tasks/{taskId}/checklist - Get task checklist items
 * POST /api/v1/projects/tasks/{taskId}/checklist - Create checklist item
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function GET(request: Request) {
  try {
    return await controller.getTaskChecklist()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createChecklistItem()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';