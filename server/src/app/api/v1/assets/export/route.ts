/**
 * Asset Export API Route
 * GET /api/v1/assets/export - Export assets
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function GET(request: Request) {
  try {
    return await controller.export()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';