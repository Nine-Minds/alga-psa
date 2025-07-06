/**
 * Asset Relationship Detail API Route
 * DELETE /api/v1/assets/relationships/{relationshipId} - Delete asset relationship
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.deleteRelationship(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';