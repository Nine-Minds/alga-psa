/**
 * [id] API Routes
 * Path: /api/v1/assets/[id]
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiAssetControllerV2();

export async function GET(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.getById(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.update(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.delete(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
