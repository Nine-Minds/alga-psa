/**
 * Asset API Routes
 * Path: /api/v2/assets
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets - List assets
export const GET = withMiddleware(
  controller.list.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);

// POST /api/v2/assets - Create new asset
export const POST = withMiddleware(
  controller.create.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'create')
);