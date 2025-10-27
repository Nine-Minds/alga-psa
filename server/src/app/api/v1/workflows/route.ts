/**
 * Workflows API Routes
 * GET /api/v1/workflows - List workflow registrations
 * POST /api/v1/workflows - Create workflow registration
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.listWorkflowRegistrations()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.createWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';