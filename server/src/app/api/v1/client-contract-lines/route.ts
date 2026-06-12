/**
 * Client Contract Lines API Routes
 * GET  /api/v1/client-contract-lines - List client contract lines
 * POST /api/v1/client-contract-lines - Assign contract line to client
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.listClientContractLines()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.assignContractLineToClient()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});
