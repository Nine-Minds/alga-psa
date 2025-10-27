/**
 * Ticket Category Tree API Route
 * GET /api/v1/categories/ticket/tree - Get ticket category tree
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request) {
  return controller.getCategoryTree()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';