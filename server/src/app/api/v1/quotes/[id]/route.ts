/**
 * Quote by ID API Route
 * GET /api/v1/quotes/[id] - Get quote by ID
 * PUT /api/v1/quotes/[id] - Update quote
 * DELETE /api/v1/quotes/[id] - Delete quote
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getById()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.update()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.delete()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
