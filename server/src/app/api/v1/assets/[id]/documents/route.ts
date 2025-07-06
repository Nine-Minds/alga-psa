/**
 * Asset Documents API Routes
 * GET /api/v1/assets/{id}/documents - List asset documents
 * POST /api/v1/assets/{id}/documents - Associate document with asset
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.listDocuments(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.associateDocument(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';