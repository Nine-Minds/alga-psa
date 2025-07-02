/**
 * Service Category by ID API Route
 * GET /api/v1/categories/service/[id] - Get service category by ID
 * PUT /api/v1/categories/service/[id] - Update service category
 * DELETE /api/v1/categories/service/[id] - Delete service category
 */

import { CategoryController } from 'server/src/lib/api/controllers/CategoryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getServiceCategory()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.updateServiceCategory()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.deleteServiceCategory()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';