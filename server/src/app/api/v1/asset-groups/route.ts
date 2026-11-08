/**
 * Asset groups (FR-E9)
 * Path: /api/v1/asset-groups
 */

import { ApiAssetGroupController } from '@/lib/api/controllers/ApiAssetGroupController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetGroupController();

export const GET = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.list(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withApiKeyRouteAuth(async (request) => {
  try {
    return await controller.create(request as any);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
