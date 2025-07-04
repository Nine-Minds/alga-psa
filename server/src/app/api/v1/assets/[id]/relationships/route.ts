/**
 * Asset Relationships API Routes
 * GET /api/v1/assets/{id}/relationships - List asset relationships
 * POST /api/v1/assets/{id}/relationships - Create asset relationship
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.listRelationships()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.createRelationship()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';