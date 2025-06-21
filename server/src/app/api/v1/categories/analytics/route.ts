/**
 * Categories Analytics API Route
 * GET /api/v1/categories/analytics - Get category analytics
 */

import { CategoryTagController } from 'server/src/lib/api/controllers/CategoryTagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryTagController();

export async function GET(request: Request) {
  try {
    return await controller.getCategoryAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';