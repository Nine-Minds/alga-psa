/**
 * Asset Documents API Routes
 * GET /api/v1/assets/{id}/documents - List asset documents
 * POST /api/v1/assets/{id}/documents - Associate document with asset
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.listDocuments()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.associateDocument()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';