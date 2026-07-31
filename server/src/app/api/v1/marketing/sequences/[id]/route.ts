/**
 * GET /api/v1/marketing/sequences/[id] - Get nurture sequence detail
 * PUT /api/v1/marketing/sequences/[id] - Update nurture sequence
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getSequence()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateSequence()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
