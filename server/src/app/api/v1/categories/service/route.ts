/**
 * Service Categories API Route
 * GET /api/v1/categories/service - List service categories
 * POST /api/v1/categories/service - Create service category
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request) {
  return controller.listServiceCategories()(request as any);
}

export async function POST(request: Request) {
  return controller.createServiceCategory()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';