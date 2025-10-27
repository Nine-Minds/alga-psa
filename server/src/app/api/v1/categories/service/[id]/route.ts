/**
 * Service Category by ID API Route
 * GET /api/v1/categories/service/[id] - Get service category by ID
 * PUT /api/v1/categories/service/[id] - Update service category
 * DELETE /api/v1/categories/service/[id] - Delete service category
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getServiceCategory()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateServiceCategory()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deleteServiceCategory()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';