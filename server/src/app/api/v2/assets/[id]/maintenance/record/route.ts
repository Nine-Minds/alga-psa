/**
 * Asset Maintenance Record API Routes
 * Path: /api/v2/assets/{id}/maintenance/record
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// POST /api/v2/assets/{id}/maintenance/record - Record maintenance performed
export const POST = withMiddleware(
  controller.recordMaintenance.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);