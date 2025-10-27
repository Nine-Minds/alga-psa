/**
 * Move Ticket Category API Route
 * POST /api/v1/categories/ticket/move - Move category in hierarchy
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function POST(request: Request) {
  return controller.moveCategory()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';