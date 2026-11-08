/**
 * Delete an asset relationship by its schema-backed composite endpoint identity.
 * Path: /api/v1/assets/relationships/[parentAssetId]:[childAssetId]
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetController();

export const DELETE = withApiKeyRouteAuth<{ relationshipId: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    return await controller.deleteRelationship(request as any, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
