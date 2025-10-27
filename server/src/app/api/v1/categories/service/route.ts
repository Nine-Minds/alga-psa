/**
 * Service Categories API Route
 * GET /api/v1/categories/service - List service categories
 * POST /api/v1/categories/service - Create service category
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request) {
  return controller.listServiceCategories()(request as any);
}

export async function POST(request: Request) {
  return controller.createServiceCategory()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';