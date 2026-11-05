/**
 * Site audit marks (mobile 2.0 FR17)
 * Path: /api/v1/asset-audits/[id]/items
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
    return await controller.markItem(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
