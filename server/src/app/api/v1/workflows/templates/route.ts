/**
 * Workflow Templates API Routes
 * GET /api/v1/workflows/templates - List workflow templates
 * POST /api/v1/workflows/templates - Create workflow template
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function GET(request: Request) {
  try {
    return await controller.listWorkflowTemplates()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createWorkflowTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';