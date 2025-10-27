/**
 * Workflow Events API Routes
 * GET /api/v1/workflows/events - List workflow events
 * POST /api/v1/workflows/events - Create workflow event
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.listWorkflowEvents()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.createWorkflowEvent()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';