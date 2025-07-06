/**
 * Asset Export API Routes
 * Path: /api/v2/assets/export
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/export - Export assets
export const GET = withMiddleware(
  controller.export.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);