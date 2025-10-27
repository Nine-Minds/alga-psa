/**
 * Categories Bulk Delete API Route
 * POST /api/v1/categories/bulk/delete - Bulk delete categories
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function POST(request: Request) {
  return controller.bulkDeleteCategories()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';