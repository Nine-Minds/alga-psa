/**
 * Asset Detail API Routes
 * GET /api/v1/assets/{id} - Get asset details
 * PUT /api/v1/assets/{id} - Update asset
 * DELETE /api/v1/assets/{id} - Delete asset
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function GET(request: Request) {
  try {
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';