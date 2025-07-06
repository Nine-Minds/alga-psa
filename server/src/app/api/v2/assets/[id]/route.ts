/**
 * Asset Detail API Routes
 * Path: /api/v2/assets/{id}
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/{id} - Get asset details
export const GET = withMiddleware(
  controller.getById.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);

// PUT /api/v2/assets/{id} - Update asset
export const PUT = withMiddleware(
  controller.update.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);

// DELETE /api/v2/assets/{id} - Delete asset
export const DELETE = withMiddleware(
  controller.delete.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'delete')
);