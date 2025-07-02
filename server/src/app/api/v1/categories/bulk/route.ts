/**
 * Categories Bulk Operations API Route
 * DELETE /api/v1/categories/bulk - Bulk delete categories
 */

import { CategoryController } from 'server/src/lib/api/controllers/CategoryController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CategoryController();

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDeleteCategories()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';