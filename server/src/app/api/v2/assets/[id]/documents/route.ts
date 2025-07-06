/**
 * Asset Documents API Routes
 * Path: /api/v2/assets/{id}/documents
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// GET /api/v2/assets/{id}/documents - List asset documents
export const GET = withMiddleware(
  controller.listDocuments.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'read')
);

// POST /api/v2/assets/{id}/documents - Associate document with asset
export const POST = withMiddleware(
  controller.associateDocument.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);