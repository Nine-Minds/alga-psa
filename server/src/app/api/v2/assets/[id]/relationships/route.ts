/**
 * Asset Relationships API Routes
 * Path: /api/v2/assets/{id}/relationships
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/{id}/relationships - List asset relationships
export const GET = withMiddleware(
  controller.listRelationships.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);

// POST /api/v2/assets/{id}/relationships - Create asset relationship
export const POST = withMiddleware(
  controller.createRelationship.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);