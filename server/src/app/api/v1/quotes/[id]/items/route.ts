/**
 * Quote Items API Route
 * GET /api/v1/quotes/[id]/items - List quote items
 * POST /api/v1/quotes/[id]/items - Add item to quote
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listItems()(req);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.addItem()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
