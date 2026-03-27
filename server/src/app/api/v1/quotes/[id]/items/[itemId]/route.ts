/**
 * Quote Item by ID API Route
 * PUT /api/v1/quotes/[id]/items/[itemId] - Update quote item
 * DELETE /api/v1/quotes/[id]/items/[itemId] - Remove quote item
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateItem()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deleteItem()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
