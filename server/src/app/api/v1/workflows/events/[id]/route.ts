/**
 * Individual Workflow Event API Routes
 * GET /api/v1/workflows/events/{id} - Get workflow event details
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.getWorkflowEvent()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';