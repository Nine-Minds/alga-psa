/**
 * Categories Analytics API Route
 * GET /api/v1/categories/analytics - Get category analytics
 */

import { CategoryController } from 'server/src/lib/api/controllers/CategoryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryController();

export async function GET(request: Request) {
  try {
    return await controller.getCategoryAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';