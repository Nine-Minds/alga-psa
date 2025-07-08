/**
 * [relationshipId] API Routes
 * Path: /api/v1/assets/relationships/[relationshipId]
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiAssetController();

export async function DELETE(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    return await controller.deleteRelationship(request as any, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
