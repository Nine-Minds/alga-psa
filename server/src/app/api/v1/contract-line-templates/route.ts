/**
 * Contract Line Templates API Routes
 * POST /api/v1/contract-line-templates - Create a contract line template
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const controller = new ApiContractLineController();

export const POST = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.createTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});
