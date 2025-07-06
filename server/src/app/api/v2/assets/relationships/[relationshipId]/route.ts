/**
 * Asset Relationship Detail API Routes
 * Path: /api/v2/assets/relationships/{relationshipId}
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// DELETE /api/v2/assets/relationships/{relationshipId} - Delete asset relationship
export const DELETE = withMiddleware(
  controller.deleteRelationship.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);