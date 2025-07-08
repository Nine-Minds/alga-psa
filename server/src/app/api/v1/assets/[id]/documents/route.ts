/**
 * documents API Routes
 * Path: /api/v1/assets/[id]/documents
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiAssetController();

export async function GET(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.listDocuments(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<any> }) {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.associateDocument(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
