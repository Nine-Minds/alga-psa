/**
 * Service Categories API Route
 * GET /api/v1/categories/service - List service categories
 * POST /api/v1/categories/service - Create service category
 */

import { CategoryController } from 'server/src/lib/api/controllers/CategoryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryController();

export async function GET(request: Request) {
  try {
    return await controller.listServiceCategories()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createServiceCategory()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';