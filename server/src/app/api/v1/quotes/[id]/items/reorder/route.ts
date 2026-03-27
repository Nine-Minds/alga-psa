/**
 * Reorder Quote Items API Route
 * POST /api/v1/quotes/[id]/items/reorder - Reorder line items
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.reorderItems()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
