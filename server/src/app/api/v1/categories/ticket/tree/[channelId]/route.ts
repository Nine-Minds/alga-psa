/**
 * Ticket Category Tree by Channel API Route
 * GET /api/v1/categories/ticket/tree/[channelId] - Get ticket category tree for a channel
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getCategoryTree()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';