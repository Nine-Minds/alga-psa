/**
 * Categories Analytics API Route
 * GET /api/v1/categories/analytics - Get category analytics
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request) {
  return controller.getCategoryAnalytics()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';