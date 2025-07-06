/**
 * Asset Relationships API Routes
 * GET /api/v1/assets/{id}/relationships - List asset relationships
 * POST /api/v1/assets/{id}/relationships - Create asset relationship
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.listRelationships(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.createRelationship(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';