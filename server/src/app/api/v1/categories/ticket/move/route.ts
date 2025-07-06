/**
 * Move Ticket Category API Route
 * POST /api/v1/categories/ticket/move - Move category in hierarchy
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function POST(request: Request) {
  return controller.moveCategory()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';