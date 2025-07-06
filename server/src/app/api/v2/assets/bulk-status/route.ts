/**
 * Asset Bulk Status Update API Routes
 * Path: /api/v2/assets/bulk-status
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// PUT /api/v2/assets/bulk-status - Bulk update asset status
export const PUT = withMiddleware(
  controller.bulkStatusUpdate.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);