/**
 * Asset Maintenance History API Routes
 * Path: /api/v2/assets/{id}/history
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/{id}/history - Get maintenance history
export const GET = withMiddleware(
  controller.getMaintenanceHistory.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);