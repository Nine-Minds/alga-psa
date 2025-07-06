/**
 * Asset Document Association API Routes
 * Path: /api/v2/assets/documents/{associationId}
 */

import { withMiddleware } from '@/lib/api/middleware/withMiddleware';
import { authMiddleware } from '@/lib/api/middleware/authMiddleware';
import { permissionMiddleware } from '@/lib/api/middleware/permissionMiddleware';
import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';

const controller = new ApiAssetControllerV2();

// DELETE /api/v2/assets/documents/{associationId} - Remove document association
export const DELETE = withMiddleware(
  controller.removeDocumentAssociation.bind(controller),
  authMiddleware,
  permissionMiddleware('asset', 'update')
);