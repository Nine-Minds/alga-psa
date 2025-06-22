/**
 * Asset Relationship Detail API Route
 * DELETE /api/v1/assets/relationships/{relationshipId} - Delete asset relationship
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function DELETE(request: Request) {
  try {
    return await controller.deleteRelationship()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';