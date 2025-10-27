/**
 * Categories Search API Route
 * GET /api/v1/categories/search - Search categories
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request) {
  return controller.searchCategories()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';