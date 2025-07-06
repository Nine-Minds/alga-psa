/**
 * Ticket Category Tree API Route
 * GET /api/v1/categories/ticket/tree - Get ticket category tree
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request) {
  return controller.getCategoryTree()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';