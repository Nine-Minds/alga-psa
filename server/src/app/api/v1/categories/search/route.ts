/**
 * Categories Search API Route
 * GET /api/v1/categories/search - Search categories
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request) {
  return controller.searchCategories()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';