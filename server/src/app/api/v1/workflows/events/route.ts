/**
 * Workflow Events API Routes
 * GET /api/v1/workflows/events - List workflow events
 * POST /api/v1/workflows/events - Create workflow event
 */

import { ApiWorkflowControllerV2 } from 'server/src/lib/api/controllers/ApiWorkflowControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.listWorkflowEvents()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.createWorkflowEvent()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';