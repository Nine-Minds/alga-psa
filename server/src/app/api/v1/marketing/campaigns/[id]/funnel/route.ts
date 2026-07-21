/**
 * GET /api/v1/marketing/campaigns/[id]/funnel - Get campaign funnel counts
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getCampaignFunnel()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
