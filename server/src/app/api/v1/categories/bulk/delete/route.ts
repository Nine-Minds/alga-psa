/**
 * Categories Bulk Delete API Route
 * POST /api/v1/categories/bulk/delete - Bulk delete categories
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function POST(request: Request) {
  return controller.bulkDeleteCategories()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';