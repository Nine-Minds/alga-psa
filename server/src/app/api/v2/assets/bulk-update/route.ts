/**
 * Asset Bulk Update API Routes
 * Path: /api/v2/assets/bulk-update
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// PUT /api/v2/assets/bulk-update - Bulk update assets
export const PUT = withMiddleware(
  controller.bulkUpdate.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);