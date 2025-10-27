/**
 * Ticket Category Tree by Board API Route
 * GET /api/v1/categories/ticket/tree/[boardId] - Get ticket category tree for a board
 */

import { ApiCategoryController } from '@product/api/controllers/ApiCategoryController';

const controller = new ApiCategoryController();

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getCategoryTree()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';