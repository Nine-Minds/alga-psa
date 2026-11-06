/**
 * Site audits (mobile 2.0 FR17)
 * Path: /api/v1/asset-audits
 */

import { ApiAssetAuditController } from '@/lib/api/controllers/ApiAssetAuditController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetAuditController();

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
