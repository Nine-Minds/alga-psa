/**
 * Contract Lines Bulk Operations API Route
 * POST /api/v1/contract-lines/bulk - Bulk operations on contract lines
 */

import { ApiContractLineController } from 'server/src/lib/api/controllers/ApiContractLineController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from 'server/src/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const POST = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.bulkCreateContractLines()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const PUT = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.bulkUpdateContractLines()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const DELETE = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.bulkDeleteContractLines()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
