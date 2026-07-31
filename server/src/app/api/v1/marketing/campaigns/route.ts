/**
 * GET /api/v1/marketing/campaigns - List marketing campaigns
 * POST /api/v1/marketing/campaigns - Create marketing campaign
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.listCampaigns()(request as any);
}

export async function POST(request: Request) {
  return controller.createCampaign()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
