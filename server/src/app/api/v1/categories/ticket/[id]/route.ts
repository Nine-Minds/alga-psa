/**
 * Ticket Category by ID API Route
 * GET /api/v1/categories/ticket/[id] - Get ticket category by ID
 * PUT /api/v1/categories/ticket/[id] - Update ticket category
 * DELETE /api/v1/categories/ticket/[id] - Delete ticket category
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getTicketCategory()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateTicketCategory()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deleteTicketCategory()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';