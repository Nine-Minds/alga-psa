/**
 * GET /api/v1/opportunities/[id] - Get opportunity
 * PUT /api/v1/opportunities/[id] - Update opportunity
 * DELETE /api/v1/opportunities/[id] - Delete opportunity
 */

import { ApiOpportunityController } from 'server/src/lib/api/controllers/ApiOpportunityController';

const controller = new ApiOpportunityController();

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
