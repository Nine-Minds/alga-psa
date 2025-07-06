/**
 * Asset Maintenance Schedule Detail API Routes
 * Path: /api/v2/assets/maintenance/{scheduleId}
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// PUT /api/v2/assets/maintenance/{scheduleId} - Update maintenance schedule
export const PUT = withMiddleware(
  controller.updateMaintenanceSchedule.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);

// DELETE /api/v2/assets/maintenance/{scheduleId} - Delete maintenance schedule
export const DELETE = withMiddleware(
  controller.deleteMaintenanceSchedule.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'delete')
);