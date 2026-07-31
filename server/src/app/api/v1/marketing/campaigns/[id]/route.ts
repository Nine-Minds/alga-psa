/**
 * GET /api/v1/marketing/campaigns/[id] - Get marketing campaign
 * PUT /api/v1/marketing/campaigns/[id] - Update marketing campaign
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getCampaign()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateCampaign()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
