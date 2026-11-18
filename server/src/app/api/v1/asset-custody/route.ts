/**
 * Equipment custody queue API Route
 * Path: /api/v1/asset-custody
 */

import { ApiAssetCustodyController } from '@/lib/api/controllers/ApiAssetCustodyController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetCustodyController();

export const GET = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.queue(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
