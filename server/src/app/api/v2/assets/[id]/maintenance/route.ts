/**
 * Asset Maintenance Schedules API Routes
 * Path: /api/v2/assets/{id}/maintenance
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/{id}/maintenance - List maintenance schedules
export const GET = withMiddleware(
  controller.listMaintenanceSchedules.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);

// POST /api/v2/assets/{id}/maintenance - Create maintenance schedule
export const POST = withMiddleware(
  controller.createMaintenanceSchedule.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);