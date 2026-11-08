/**
 * Complete a site audit (mobile 2.0 FR17)
 * Path: /api/v1/asset-audits/[id]/complete
 */

import { ApiAssetAuditController } from '@/lib/api/controllers/ApiAssetAuditController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetAuditController();

export const POST = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.complete(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
